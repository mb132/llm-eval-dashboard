"""Provider dispatch for non-streaming, one-shot playground prompts."""

import asyncio
import json
import random
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from math import ceil, isfinite
from time import monotonic, perf_counter
from typing import Any
from urllib.parse import quote

import httpx

from ..models import ModelConfiguration
from ..schemas.providers import validate_provider_settings
from .credentials import CredentialConfigurationError, decrypt_api_key

REQUEST_TIMEOUT_SECONDS = 120.0
MAX_PROVIDER_RESPONSE_BYTES = 1_000_000
MAX_REPORTED_TOKENS = 1_000_000_000
OPENROUTER_FREE_REQUEST_INTERVAL_SECONDS = 3.2
OPENROUTER_RETRY_BUDGET_SECONDS = 30.0
OPENROUTER_MAX_RETRIES = 2
_openrouter_locks: dict[tuple[int, str], asyncio.Lock] = {}
_openrouter_conditions: dict[tuple[int, str], asyncio.Condition] = {}
_openrouter_active: dict[tuple[int, str], int] = {}
_openrouter_concurrency_limits: dict[tuple[int, str], int] = {}
_openrouter_rpm_limits: dict[tuple[int, str], int] = {}
_openrouter_next_slot: dict[tuple[int, str], float] = {}
_openrouter_cooldown: dict[tuple[int, str], float] = {}
DEFAULT_BASE_URLS = {
    "ollama": "http://localhost:11434",
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "anthropic": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
}


class PlaygroundConfigurationError(RuntimeError):
    """Raised when a configured model cannot safely be executed."""


class PlaygroundProviderError(RuntimeError):
    """Raised when a provider fails or returns an unusable response."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "provider_error",
        retry_after_seconds: float | None = None,
        cooldown_scope: str = "model",
        retryable: bool = True,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retry_after_seconds = retry_after_seconds
        self.cooldown_scope = cooldown_scope
        self.retryable = retryable


class PlaygroundTimeoutError(RuntimeError):
    """Raised when a provider does not finish before the request timeout."""

    code = "timeout"


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
    max_output_tokens: int | None = None,
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
        "openrouter",
        "anthropic",
        "gemini",
        "openai_compatible",
    }:
        raise PlaygroundConfigurationError("This provider is not supported.")

    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
    started_at = perf_counter()
    try:
        attempts = 0
        retry_waited = 0.0
        while True:
            try:
                if provider == "openrouter":
                    async with _openrouter_request_slot(model):
                        data = await _request_provider(
                            http_client,
                            model,
                            prompt,
                            system_prompt,
                            max_output_tokens=max_output_tokens,
                        )
                else:
                    data = await _request_provider(
                        http_client,
                        model,
                        prompt,
                        system_prompt,
                        max_output_tokens=max_output_tokens,
                    )
                break
            except PlaygroundProviderError as exc:
                attempts += 1
                if (
                    provider != "openrouter"
                    or exc.code != "rate_limit"
                    or not exc.retryable
                ):
                    raise
                if attempts > OPENROUTER_MAX_RETRIES:
                    if exc.retry_after_seconds is not None:
                        _cooldown_openrouter(
                            model, exc.retry_after_seconds, exc.cooldown_scope
                        )
                    raise PlaygroundProviderError(
                        "OpenRouter is still rate limiting requests after two "
                        "retries. Try again later.",
                        code="rate_limit",
                        retry_after_seconds=exc.retry_after_seconds,
                        cooldown_scope=exc.cooldown_scope,
                        retryable=False,
                    ) from exc
                delay = exc.retry_after_seconds
                if delay is None:
                    delay = min(30.0, 2.0**attempts) + random.uniform(0, 0.5)
                _cooldown_openrouter(model, delay, exc.cooldown_scope)
                if retry_waited + delay > OPENROUTER_RETRY_BUDGET_SECONDS:
                    raise PlaygroundProviderError(
                        f"OpenRouter requested a wait of {ceil(delay)} seconds, "
                        "beyond the automatic retry window. Try again later.",
                        code="rate_limit",
                        retry_after_seconds=delay,
                        cooldown_scope=exc.cooldown_scope,
                        retryable=False,
                    ) from exc
                retry_waited += delay
                await asyncio.sleep(delay)
        normalized = _normalize_response(provider, data)
    except PlaygroundProviderError:
        raise
    except httpx.TimeoutException as exc:
        raise PlaygroundTimeoutError("The provider request timed out.") from exc
    except httpx.RequestError as exc:
        raise PlaygroundProviderError(
            "Could not reach the provider.", code="provider_unavailable"
        ) from exc
    except ValueError as exc:
        raise PlaygroundProviderError(
            "The provider returned an invalid response.", code="malformed_response"
        ) from exc
    finally:
        latency_ms = round((perf_counter() - started_at) * 1000)
        if owns_client:
            await http_client.aclose()

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
    *,
    max_output_tokens: int | None,
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
        if max_output_tokens is not None:
            payload["options"]["num_predict"] = max_output_tokens
        if system_prompt:
            payload["system"] = system_prompt
        url = f"{_base_url(model).rstrip('/')}/api/generate"
    elif provider in {"openai", "openrouter", "openai_compatible"}:
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
        if max_output_tokens is not None:
            if provider == "openai":
                payload.pop("max_tokens", None)
                payload["max_completion_tokens"] = max_output_tokens
            else:
                payload.pop("max_completion_tokens", None)
                payload["max_tokens"] = max_output_tokens
        url = f"{_base_url(model).rstrip('/')}/chat/completions"
    elif provider == "anthropic":
        headers["x-api-key"] = credential or ""
        headers["anthropic-version"] = "2023-06-01"
        payload = dict(model.parameters)
        max_tokens = max_output_tokens or payload.get("max_tokens", 1024)
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
        if max_output_tokens is not None:
            payload["generationConfig"]["maxOutputTokens"] = max_output_tokens
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        model_name = model.model_name.removeprefix("models/")
        url = (
            f"{_base_url(model).rstrip('/')}/models/"
            f"{quote(model_name, safe='')}:generateContent"
        )

    async with client.stream("POST", url, headers=headers, json=payload) as response:
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_PROVIDER_RESPONSE_BYTES:
                raise PlaygroundProviderError(
                    "The provider returned a response that exceeds the safe size "
                    "limit.",
                    code="malformed_response",
                )
        if not 200 <= response.status_code < 300:
            message = _http_failure_message(response.status_code, body)
            if provider == "openrouter" and response.status_code == 429:
                if _is_openrouter_free_model(model.model_name):
                    message = (
                        "OpenRouter's free-model limit was reached (HTTP 429). "
                        "It may be a per-minute or daily limit; wait or reduce "
                        "the evaluation request count."
                    )
                else:
                    message = (
                        "OpenRouter's model or account rate limit was reached "
                        "(HTTP 429). Wait or reduce the evaluation request count."
                    )
            if response.status_code == 429 and b"free-models-per-day" in body:
                message = (
                    "OpenRouter's free-model daily quota is exhausted. "
                    "Wait for its reset or use a paid model."
                )
            raise PlaygroundProviderError(
                message,
                code=(
                    "daily_quota"
                    if response.status_code == 429
                    and (b"free-models-per-day" in body or b"free_model_daily" in body)
                    else _http_failure_code(response.status_code, body)
                ),
                retry_after_seconds=(
                    _response_retry_delay(response.headers)
                    if response.status_code == 429
                    else None
                ),
                cooldown_scope=(
                    "platform" if response.headers.get("X-RateLimit-Limit") else "model"
                ),
            )
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise PlaygroundProviderError(
            "The provider returned an invalid response object.",
            code="malformed_response",
        )
    data: dict[str, Any] = parsed
    return data


def _is_openrouter_free_model(model_name: str) -> bool:
    return model_name.endswith(":free") or model_name == "openrouter/free"


@asynccontextmanager
async def _openrouter_request_slot(model: ModelConfiguration):
    """Apply shared RPM spacing and concurrency settings for one model."""
    provider_id = model.provider.id
    model_name = model.model_name
    is_free = _is_openrouter_free_model(model_name)
    key = (provider_id, model_name)
    pacing_key = (0, "free") if is_free else key
    lock = _openrouter_locks.setdefault(pacing_key, asyncio.Lock())
    configured_rpm = model.requests_per_minute
    shared_rpm = _openrouter_rpm_limits.get(key)
    if configured_rpm is not None and shared_rpm is not None:
        configured_rpm = min(configured_rpm, shared_rpm)
    elif shared_rpm is not None:
        configured_rpm = shared_rpm
    interval = (
        OPENROUTER_FREE_REQUEST_INTERVAL_SECONDS
        if is_free and configured_rpm is None
        else (60.0 / configured_rpm if configured_rpm else 0.0)
    )
    if is_free:
        interval = max(OPENROUTER_FREE_REQUEST_INTERVAL_SECONDS, interval)
    async with lock:
        now = monotonic()
        cooldown_delay = (
            max(
                _openrouter_cooldown.get(key, 0.0),
                _openrouter_cooldown.get((provider_id, "*"), 0.0),
            )
            - now
        )
        _reject_long_openrouter_cooldown(cooldown_delay)
        slot = max(
            now,
            _openrouter_next_slot.get(pacing_key, now),
            _openrouter_cooldown.get(key, 0.0),
            _openrouter_cooldown.get((provider_id, "*"), 0.0),
        )
        _openrouter_next_slot[pacing_key] = slot + interval
    delay = slot - monotonic()
    if delay > 0:
        await asyncio.sleep(delay)
    condition = _openrouter_conditions.setdefault(key, asyncio.Condition())
    maximum = model.max_concurrent_requests
    acquired = False
    if maximum is not None:
        async with condition:
            current = _openrouter_concurrency_limits.get(key)
            _openrouter_concurrency_limits[key] = (
                maximum if current is None else min(current, maximum)
            )
    while True:
        cooldown_delay = (
            max(
                _openrouter_cooldown.get(key, 0.0),
                _openrouter_cooldown.get((provider_id, "*"), 0.0),
            )
            - monotonic()
        )
        if cooldown_delay > 0:
            _reject_long_openrouter_cooldown(cooldown_delay)
            await asyncio.sleep(cooldown_delay)
            continue
        async with condition:
            while (
                key in _openrouter_concurrency_limits
                and _openrouter_active.get(key, 0)
                >= _openrouter_concurrency_limits[key]
            ):
                await condition.wait()
            cooldown_delay = (
                max(
                    _openrouter_cooldown.get(key, 0.0),
                    _openrouter_cooldown.get((provider_id, "*"), 0.0),
                )
                - monotonic()
            )
            if cooldown_delay <= 0:
                if key in _openrouter_concurrency_limits:
                    _openrouter_active[key] = _openrouter_active.get(key, 0) + 1
                    acquired = True
                break
    try:
        yield
    finally:
        if acquired:
            async with condition:
                _openrouter_active[key] = max(0, _openrouter_active.get(key, 1) - 1)
                condition.notify_all()


def _cooldown_openrouter(model: ModelConfiguration, seconds: float, scope: str) -> None:
    key = (model.provider.id, "*" if scope == "platform" else model.model_name)
    _openrouter_cooldown[key] = max(
        _openrouter_cooldown.get(key, 0.0), monotonic() + seconds
    )


def _reject_long_openrouter_cooldown(delay: float) -> None:
    if delay > OPENROUTER_RETRY_BUDGET_SECONDS:
        raise PlaygroundProviderError(
            f"OpenRouter rate limit resets in about {ceil(delay)} seconds. "
            "Try again later.",
            code="rate_limit",
            retry_after_seconds=delay,
            retryable=False,
        )


def configure_openrouter_model_limits(
    provider_id: int,
    model_name: str,
    rpm_values: list[int],
    concurrency_values: list[int],
) -> None:
    """Publish the strictest limits among active duplicate model configurations."""
    key = (provider_id, model_name)
    if rpm_values:
        _openrouter_rpm_limits[key] = min(rpm_values)
    else:
        _openrouter_rpm_limits.pop(key, None)
    if concurrency_values:
        _openrouter_concurrency_limits[key] = min(concurrency_values)
    else:
        _openrouter_concurrency_limits.pop(key, None)
    condition = _openrouter_conditions.get(key)
    if condition is not None:

        async def wake_waiters() -> None:
            async with condition:
                condition.notify_all()

        asyncio.create_task(wake_waiters())


def _retry_after_seconds(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        delay = float(value)
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=UTC)
            delay = (date - datetime.now(UTC)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return None
    return max(0.0, delay) if isfinite(delay) else None


def _response_retry_delay(headers: httpx.Headers) -> float | None:
    retry_after = _retry_after_seconds(headers.get("Retry-After"))
    if retry_after is not None:
        return retry_after
    reset_header = headers.get("X-RateLimit-Reset")
    if reset_header is None:
        return None
    try:
        reset = float(reset_header)
    except ValueError:
        try:
            reset_date = datetime.fromisoformat(reset_header.replace("Z", "+00:00"))
            if reset_date.tzinfo is None:
                reset_date = reset_date.replace(tzinfo=UTC)
            return max(0.0, (reset_date - datetime.now(UTC)).total_seconds())
        except ValueError:
            return _retry_after_seconds(reset_header)
    if not isfinite(reset):
        return None
    # Reset timestamps can be expressed in seconds or milliseconds since epoch.
    if reset > 1_000_000_000_000:
        reset /= 1000
    if reset > 86_400:
        return max(0.0, reset - datetime.now(UTC).timestamp())
    return max(0.0, reset)


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
    if (
        model.provider.kind in {"openai", "openrouter", "anthropic", "gemini"}
        and not credential
    ):
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
    elif provider in {"openai", "openrouter", "openai_compatible"}:
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
            "The provider response did not contain generated text.",
            code="malformed_response",
        )
    return value.strip()


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _optional_int(value: object) -> int | None:
    if (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= MAX_REPORTED_TOKENS
    ):
        return value
    return None


def _sum_tokens(input_tokens: int | None, output_tokens: int | None) -> int | None:
    if input_tokens is None or output_tokens is None:
        return None
    return _optional_int(input_tokens + output_tokens)


def _sum_optional_values(data: dict[str, Any], *keys: str) -> int | None:
    values = [_optional_int(data.get(key)) for key in keys]
    present = [value for value in values if value is not None]
    return _optional_int(sum(present)) if present else None


def _mapping(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PlaygroundProviderError(
            "The provider returned an invalid response.", code="malformed_response"
        )
    return value


def _optional_mapping(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list[Any]:
    if not isinstance(value, list):
        raise PlaygroundProviderError(
            "The provider returned an invalid response.", code="malformed_response"
        )
    return value


def _first_mapping(value: object) -> dict[str, Any]:
    values = _list(value)
    if not values:
        raise PlaygroundProviderError(
            "The provider returned an empty response.", code="malformed_response"
        )
    return _mapping(values[0])


def _http_failure_code(status_code: int, body: bytes | bytearray) -> str:
    """Classify a provider rejection without retaining its untrusted body."""
    hint = _provider_error_hint(body)
    if hint in {
        "authentication_error",
        "invalid_api_key",
        "api_key_invalid",
        "unauthenticated",
    }:
        return "invalid_api_key"
    if hint in {"rate_limit", "rate_limit_error", "resource_exhausted"}:
        return "rate_limit"
    if hint in {"timeout", "deadline_exceeded"}:
        return "timeout"
    if hint in {"model_not_found", "model_not_supported", "unsupported_model"}:
        return "unsupported_model"
    if status_code == 401:
        return "invalid_api_key"
    if status_code == 429:
        return "rate_limit"
    if status_code in {408, 504}:
        return "timeout"
    if status_code >= 500:
        return "provider_unavailable"
    return "provider_error"


def _http_failure_message(status_code: int, body: bytes | bytearray) -> str:
    """Return a safe application-authored explanation for a provider rejection."""
    messages = {
        "invalid_api_key": f"The provider rejected the API key (HTTP {status_code}).",
        "rate_limit": f"The provider rate limit was reached (HTTP {status_code}).",
        "timeout": f"The provider request timed out (HTTP {status_code}).",
        "unsupported_model": (
            f"The requested model is unsupported or unavailable (HTTP {status_code})."
        ),
        "provider_unavailable": (
            f"The provider is currently unavailable (HTTP {status_code})."
        ),
    }
    return messages.get(
        _http_failure_code(status_code, body),
        f"The provider returned HTTP {status_code}.",
    )


def _provider_error_hint(body: bytes | bytearray) -> str | None:
    """Extract only standard provider error identifiers, never provider messages."""
    try:
        parsed = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None
    error = parsed.get("error")
    candidates: list[object] = [parsed.get("code"), parsed.get("status")]
    if isinstance(error, dict):
        candidates.extend((error.get("type"), error.get("code"), error.get("status")))
    for candidate in candidates:
        if isinstance(candidate, str):
            return candidate.strip().lower()
    return None
