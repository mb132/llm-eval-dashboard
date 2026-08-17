"""Small, Ollama-specific client for the first evaluation slice."""

import os
from dataclasses import dataclass
from time import perf_counter
from typing import Any

import httpx

DEFAULT_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "gemma4:e4b"
REQUEST_TIMEOUT_SECONDS = 120.0


class OllamaError(RuntimeError):
    """Raised when Ollama cannot produce a usable evaluation response."""


@dataclass(frozen=True, slots=True)
class OllamaResult:
    """Normalized subset of the Ollama response used by the application."""

    model: str
    response: str
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None


async def run_evaluation(
    prompt: str,
    question: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> OllamaResult:
    """Send one non-streaming generation request and normalize its metrics."""
    base_url = os.getenv("OLLAMA_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    model = os.getenv("OLLAMA_MODEL", DEFAULT_MODEL)
    payload = {
        "model": model,
        "prompt": f"{prompt}\n\nQuestion: {question}",
        "stream": False,
    }

    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
    started_at = perf_counter()
    try:
        response = await http_client.post(f"{base_url}/api/generate", json=payload)
        response.raise_for_status()
        data: dict[str, Any] = response.json()
    except httpx.TimeoutException as exc:
        raise OllamaError(
            "Ollama timed out. Check that it is running and the model is available."
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise OllamaError(
            f"Ollama returned HTTP {exc.response.status_code}. "
            "Check that gemma4:e4b is available."
        ) from exc
    except (httpx.RequestError, ValueError) as exc:
        raise OllamaError(
            "Could not reach Ollama. Check OLLAMA_BASE_URL and that Ollama is running."
        ) from exc
    finally:
        latency_ms = round((perf_counter() - started_at) * 1000)
        if owns_client:
            await http_client.aclose()

    generated_text = data.get("response")
    if not isinstance(generated_text, str):
        raise OllamaError("Ollama returned an invalid response without generated text.")

    return OllamaResult(
        model=str(data.get("model") or model),
        response=generated_text.strip(),
        latency_ms=latency_ms,
        input_tokens=_optional_int(data.get("prompt_eval_count")),
        output_tokens=_optional_int(data.get("eval_count")),
    )


def _optional_int(value: object) -> int | None:
    """Return an integer metric when Ollama supplied one."""
    return value if isinstance(value, int) and not isinstance(value, bool) else None
