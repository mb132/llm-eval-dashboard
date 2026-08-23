"""Bounded Ollama provider adapter with normalized results and safe errors."""

import json
import os
from dataclasses import dataclass
from time import perf_counter

import httpx

DEFAULT_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "gemma4:e4b"
REQUEST_TIMEOUT_SECONDS = 120.0
MAX_OUTPUT_TOKENS = 1_024
MAX_PROVIDER_RESPONSE_BYTES = 1_000_000
MAX_MODEL_NAME_LENGTH = 200


class OllamaError(RuntimeError):
    """Raised when Ollama cannot produce a usable evaluation response."""

    def __init__(self, message: str, *, code: str = "provider_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class OllamaResult:
    """Normalized subset of an Ollama response used by the application."""

    model: str
    response: str
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None


async def generate_ollama_response(
    prompt: str,
    model: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> OllamaResult:
    """Send one bounded non-streaming generation request and normalize metrics."""
    base_url = os.getenv("OLLAMA_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"num_predict": MAX_OUTPUT_TOKENS},
    }

    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
    started_at = perf_counter()
    try:
        async with http_client.stream(
            "POST", f"{base_url}/api/generate", json=payload
        ) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_PROVIDER_RESPONSE_BYTES:
                    raise OllamaError(
                        "Ollama returned a response that exceeds the safe size limit.",
                        code="response_too_large",
                    )
        data = json.loads(body)
    except OllamaError:
        raise
    except httpx.TimeoutException as exc:
        raise OllamaError(
            "Ollama timed out. Check that it is running and the model is available.",
            code="timeout",
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise OllamaError(
            f"Ollama returned HTTP {exc.response.status_code}. "
            "Check that the selected model is available.",
            code="provider_http_error",
        ) from exc
    except httpx.RequestError as exc:
        raise OllamaError(
            "Could not reach Ollama. Check OLLAMA_BASE_URL and that Ollama is running.",
            code="connection_error",
        ) from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise OllamaError(
            "Ollama returned an invalid JSON response.",
            code="invalid_response",
        ) from exc
    finally:
        latency_ms = round((perf_counter() - started_at) * 1000)
        if owns_client:
            await http_client.aclose()

    if not isinstance(data, dict):
        raise OllamaError(
            "Ollama returned an invalid response object.", code="invalid_response"
        )
    generated_text = data.get("response")
    if not isinstance(generated_text, str):
        raise OllamaError(
            "Ollama returned an invalid response without generated text.",
            code="invalid_response",
        )
    reported_model = data.get("model")
    if not isinstance(reported_model, str) or not reported_model.strip():
        reported_model = model
    if len(reported_model) > MAX_MODEL_NAME_LENGTH:
        raise OllamaError(
            "Ollama returned an invalid model identifier.", code="invalid_response"
        )

    return OllamaResult(
        model=reported_model,
        response=generated_text,
        latency_ms=latency_ms,
        input_tokens=_optional_nonnegative_int(data.get("prompt_eval_count")),
        output_tokens=_optional_nonnegative_int(data.get("eval_count")),
    )


def _optional_nonnegative_int(value: object) -> int | None:
    """Return a nonnegative integer metric when Ollama supplied one."""
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None
