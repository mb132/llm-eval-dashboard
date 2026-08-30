"""Provider dispatch for non-streaming, one-shot playground prompts."""

from dataclasses import dataclass
from time import perf_counter
from typing import Any
from urllib.parse import quote

import httpx

from ..models import ModelConfiguration
from ..schemas.providers import validate_provider_settings
from .credentials import CredentialConfigurationError, decrypt_api_key

REQUEST_TIMEOUT_SECONDS = 120.0
DEFAULT_BASE_URLS = {
    "ollama": "http://localhost:11434",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
}


class PlaygroundConfigurationError(RuntimeError):
    """Raised when a configured model cannot safely be executed."""


class PlaygroundProviderError(RuntimeError):
    """Raised when a provider fails or returns an unusable response."""


class PlaygroundTimeoutError(RuntimeError):
    """Raised when a provider does not finish before the request timeout."""


@dataclass(frozen=True, slots=True)
class PlaygroundResult:
    """Provider-independent generation result."""

    response: str
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    finish_reason: str | None


async def generate_prompt(
    model: ModelConfiguration,
    prompt: str,
    system_prompt: str | None,
    *,
    client: httpx.AsyncClient | None = None,
) -> PlaygroundResult:
    """Execute a prompt through the adapter selected by the stored provider."""
    provider = model.provider.kind
    if provider == "custom":
        raise PlaygroundConfigurationError(
            "Custom endpoints do not define an executable protocol."
        )
    if provider not in {
        "ollama",
        "openai",
        "anthropic",
        "gemini",
        "openai_compatible",
    }:
        raise PlaygroundConfigurationError("This provider is not supported.")

    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
    started_at = perf_counter()
    try:
        data = await _request_provider(
            http_client,
            model,
            prompt,
            system_prompt,
        )
    except httpx.TimeoutException as exc:
        raise PlaygroundTimeoutError("The provider request timed out.") from exc
    except httpx.HTTPStatusError as exc:
        raise PlaygroundProviderError(
            f"The provider returned HTTP {exc.response.status_code}."
        ) from exc
    except httpx.RequestError as exc:
        raise PlaygroundProviderError("Could not reach the provider.") from exc
    except ValueError as exc:
        raise PlaygroundProviderError("The provider returned invalid JSON.") from exc
    finally:
        latency_ms = round((perf_counter() - started_at) * 1000)
        if owns_client:
            await http_client.aclose()

    normalized = _normalize_response(provider, data)
    return PlaygroundResult(
        response=normalized.response,
        latency_ms=latency_ms,
        input_tokens=normalized.input_tokens,
        output_tokens=normalized.output_tokens,
        total_tokens=normalized.total_tokens,
        finish_reason=normalized.finish_reason,
    )


async def _request_provider(
    client: httpx.AsyncClient,
    model: ModelConfiguration,
    prompt: str,
    system_prompt: str | None,
) -> dict[str, Any]:
    provider = model.provider.kind
    credential = _resolve_credential(model)
    headers = {"Content-Type": "application/json"}

    if provider == "ollama":
        if credential:
            headers["Authorization"] = f"Bearer {credential}"
        payload: dict[str, Any] = {
            "model": model.model_name,
            "prompt": prompt,
            "stream": False,
            "options": dict(model.parameters),
        }
        if system_prompt:
            payload["system"] = system_prompt
        url = f"{_base_url(model).rstrip('/')}/api/generate"
    elif provider in {"openai", "openai_compatible"}:
        if credential:
            headers["Authorization"] = f"Bearer {credential}"
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        payload = dict(model.parameters)
        payload.update(
            {
                "model": model.model_name,
                "messages": messages,
                "stream": False,
            }
        )
        url = f"{_base_url(model).rstrip('/')}/chat/completions"
    elif provider == "anthropic":
        headers["x-api-key"] = credential or ""
        headers["anthropic-version"] = "2023-06-01"
        payload = dict(model.parameters)
        max_tokens = payload.get("max_tokens", 1024)
        payload.update(
            {
                "model": model.model_name,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "stream": False,
            }
        )
        if system_prompt:
            payload["system"] = system_prompt
        else:
            payload.pop("system", None)
        url = f"{_base_url(model).rstrip('/')}/v1/messages"
    else:
        headers["x-goog-api-key"] = credential or ""
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": dict(model.parameters),
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        model_name = model.model_name.removeprefix("models/")
        url = (
            f"{_base_url(model).rstrip('/')}/models/"
            f"{quote(model_name, safe='')}:generateContent"
        )

    response = await client.post(url, headers=headers, json=payload)
    response.raise_for_status()
    data: dict[str, Any] = response.json()
    return data


def _resolve_credential(model: ModelConfiguration) -> str | None:
    try:
        validate_provider_settings(model.provider.kind, model.provider.base_url, None)
    except ValueError as exc:
        raise PlaygroundConfigurationError(str(exc)) from exc
    ciphertext = model.provider.api_key_ciphertext
    try:
        credential = (
            decrypt_api_key(
                ciphertext,
                provider_id=model.provider.id,
                provider_kind=model.provider.kind,
            )
            if ciphertext
            else None
        )
    except CredentialConfigurationError as exc:
        raise PlaygroundConfigurationError(
            "Stored provider credential is unavailable."
        ) from exc
    if model.provider.kind in {"openai", "anthropic", "gemini"} and not credential:
        raise PlaygroundConfigurationError(
            f"The {model.provider.kind} provider requires configured credentials."
        )
    return credential


def _base_url(model: ModelConfiguration) -> str:
    if model.provider.base_url:
        return model.provider.base_url
    if model.provider.kind == "openai_compatible":
        raise PlaygroundConfigurationError(
            "OpenAI-compatible models require a base URL."
        )
    base_url = DEFAULT_BASE_URLS.get(model.provider.kind)
    if base_url is None:
        raise PlaygroundConfigurationError("This provider requires a base URL.")
    return base_url


def _normalize_response(provider: str, data: dict[str, Any]) -> PlaygroundResult:
    if provider == "ollama":
        text = _required_text(data.get("response"))
        input_tokens = _optional_int(data.get("prompt_eval_count"))
        output_tokens = _optional_int(data.get("eval_count"))
        total_tokens = _sum_tokens(input_tokens, output_tokens)
        finish_reason = _optional_text(data.get("done_reason"))
    elif provider in {"openai", "openai_compatible"}:
        choice = _first_mapping(data.get("choices"))
        message = _mapping(choice.get("message"))
        text = _required_text(message.get("content"))
        usage = _optional_mapping(data.get("usage"))
        input_tokens = _optional_int(usage.get("prompt_tokens"))
        output_tokens = _optional_int(usage.get("completion_tokens"))
        total_tokens = _optional_int(usage.get("total_tokens")) or _sum_tokens(
            input_tokens, output_tokens
        )
        finish_reason = _optional_text(choice.get("finish_reason"))
    elif provider == "anthropic":
        blocks = _list(data.get("content"))
        parts = [
            block.get("text")
            for item in blocks
            if isinstance(item, dict)
            if (block := item).get("type") == "text"
            and isinstance(block.get("text"), str)
        ]
        text = _required_text("".join(parts))
        usage = _optional_mapping(data.get("usage"))
        input_tokens = _sum_optional_values(
            usage,
            "input_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
        )
        output_tokens = _optional_int(usage.get("output_tokens"))
        total_tokens = _sum_tokens(input_tokens, output_tokens)
        finish_reason = _optional_text(data.get("stop_reason"))
    else:
        candidate = _first_mapping(data.get("candidates"))
        content = _mapping(candidate.get("content"))
        parts = _list(content.get("parts"))
        text_parts = [
            item["text"]
            for item in parts
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        text = _required_text("".join(text_parts))
        usage = _optional_mapping(data.get("usageMetadata"))
        input_tokens = _optional_int(usage.get("promptTokenCount"))
        output_tokens = _optional_int(usage.get("candidatesTokenCount"))
        total_tokens = _optional_int(usage.get("totalTokenCount")) or _sum_tokens(
            input_tokens, output_tokens
        )
        finish_reason = _optional_text(candidate.get("finishReason"))

    return PlaygroundResult(
        response=text,
        latency_ms=0,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        finish_reason=finish_reason,
    )


def _required_text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PlaygroundProviderError(
            "The provider response did not contain generated text."
        )
    return value.strip()


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _sum_tokens(input_tokens: int | None, output_tokens: int | None) -> int | None:
    if input_tokens is None or output_tokens is None:
        return None
    return input_tokens + output_tokens


def _sum_optional_values(data: dict[str, Any], *keys: str) -> int | None:
    values = [_optional_int(data.get(key)) for key in keys]
    present = [value for value in values if value is not None]
    return sum(present) if present else None


def _mapping(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PlaygroundProviderError("The provider returned an invalid response.")
    return value


def _optional_mapping(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list[Any]:
    if not isinstance(value, list):
        raise PlaygroundProviderError("The provider returned an invalid response.")
    return value


def _first_mapping(value: object) -> dict[str, Any]:
    values = _list(value)
    if not values:
        raise PlaygroundProviderError("The provider returned an empty response.")
    return _mapping(values[0])
