import asyncio
import json

import httpx
import pytest
from app.models import ModelConfiguration, ProviderConfiguration
from app.services.credentials import encrypt_api_key
from app.services.playground import (
    MAX_PROVIDER_RESPONSE_BYTES,
    MAX_REPORTED_TOKENS,
    PlaygroundConfigurationError,
    PlaygroundProviderError,
    PlaygroundTimeoutError,
    generate_prompt,
)


def model_configuration(
    provider: str,
    *,
    model_name: str = "test-model",
    base_url: str | None = None,
    api_key: str | None = None,
    parameters: dict | None = None,
) -> ModelConfiguration:
    return ModelConfiguration(
        display_name=provider.title(),
        provider_id=1,
        model_name=model_name,
        parameters=parameters or {"temperature": 0.2},
        provider=ProviderConfiguration(
            id=1,
            display_name=provider.title(),
            kind=provider,
            base_url=base_url,
            api_key_ciphertext=(
                encrypt_api_key(api_key, provider_id=1, provider_kind=provider)
                if api_key
                else None
            ),
        ),
    )


def run_with_transport(
    model, handler, *, system_prompt="Be concise.", max_output_tokens=None
):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_prompt(
                model,
                "Hello",
                system_prompt,
                max_output_tokens=max_output_tokens,
                client=client,
            )

    return asyncio.run(run())


def request_json(request: httpx.Request) -> dict:
    return json.loads(request.content)


def test_ollama_adapter_uses_configuration_and_normalizes_metrics() -> None:
    model = model_configuration(
        "ollama",
        model_name="gemma4:e4b",
        base_url="http://ollama.test/",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://ollama.test/api/generate"
        assert "authorization" not in request.headers
        assert request_json(request) == {
            "model": "gemma4:e4b",
            "prompt": "Hello",
            "system": "Be concise.",
            "stream": False,
            "options": {"temperature": 0.2, "num_predict": 1024},
        }
        return httpx.Response(
            200,
            json={
                "response": " Hello there ",
                "prompt_eval_count": 5,
                "eval_count": 3,
                "done_reason": "stop",
            },
        )

    result = run_with_transport(model, handler, max_output_tokens=1024)
    assert result.response == "Hello there"
    assert result.input_tokens == 5
    assert result.output_tokens == 3
    assert result.total_tokens == 8
    assert result.finish_reason == "stop"


@pytest.mark.parametrize(
    ("provider", "base_url", "credential_name"),
    [
        ("openai", None, "OPENAI_API_KEY"),
        ("openai_compatible", "https://compatible.test/v1", None),
    ],
)
def test_openai_adapters_send_chat_completions(
    provider: str,
    base_url: str | None,
    credential_name: str | None,
    monkeypatch,
) -> None:
    model = model_configuration(
        provider,
        base_url=base_url,
        api_key="test-secret" if credential_name else None,
        parameters={"temperature": 0.4, "model": "must-not-win", "stream": True},
    )

    def handler(request: httpx.Request) -> httpx.Response:
        expected_base = base_url or "https://api.openai.com/v1"
        assert str(request.url) == f"{expected_base}/chat/completions"
        if credential_name:
            assert request.headers["authorization"] == "Bearer test-secret"
        else:
            assert "authorization" not in request.headers
        body = request_json(request)
        assert body["model"] == "test-model"
        assert body["stream"] is False
        assert body["temperature"] == 0.4
        expected_token_field = (
            "max_completion_tokens" if provider == "openai" else "max_tokens"
        )
        assert body[expected_token_field] == 1024
        assert body["messages"] == [
            {"role": "system", "content": "Be concise."},
            {"role": "user", "content": "Hello"},
        ]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {"content": "Hi!"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 7,
                    "completion_tokens": 2,
                    "total_tokens": MAX_REPORTED_TOKENS + 1,
                },
            },
        )

    result = run_with_transport(model, handler, max_output_tokens=1024)
    assert result.response == "Hi!"
    assert (result.input_tokens, result.output_tokens, result.total_tokens) == (7, 2, 9)


def test_anthropic_adapter_uses_required_headers_and_default_limit() -> None:
    model = model_configuration(
        "anthropic",
        api_key="test-secret",
        parameters={"temperature": 0.1, "system": "must-not-win"},
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.anthropic.com/v1/messages"
        assert request.headers["x-api-key"] == "test-secret"
        assert request.headers["anthropic-version"] == "2023-06-01"
        body = request_json(request)
        assert body["model"] == "test-model"
        assert body["system"] == "Be concise."
        assert body["messages"] == [{"role": "user", "content": "Hello"}]
        assert body["max_tokens"] == 1024
        assert body["stream"] is False
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "text", "text": "Hello"},
                    {"type": "text", "text": "!"},
                ],
                "usage": {
                    "input_tokens": 5,
                    "cache_creation_input_tokens": 2,
                    "cache_read_input_tokens": 1,
                    "output_tokens": 3,
                },
                "stop_reason": "end_turn",
            },
        )

    result = run_with_transport(model, handler, max_output_tokens=1024)
    assert result.response == "Hello!"
    assert (
        result.input_tokens,
        result.output_tokens,
        result.total_tokens,
    ) == (8, 3, 11)
    assert result.finish_reason == "end_turn"


def test_gemini_adapter_builds_generate_content_request() -> None:
    model = model_configuration(
        "gemini",
        model_name="models/gemini-test",
        api_key="test-secret",
        parameters={"temperature": 0.3, "maxOutputTokens": 500},
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == (
            "https://generativelanguage.googleapis.com/v1beta/"
            "models/gemini-test:generateContent"
        )
        assert request.headers["x-goog-api-key"] == "test-secret"
        assert request_json(request) == {
            "contents": [{"role": "user", "parts": [{"text": "Hello"}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1024},
            "systemInstruction": {"parts": [{"text": "Be concise."}]},
        }
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {"parts": [{"text": "Hi"}, {"text": " there"}]},
                        "finishReason": "STOP",
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 6,
                    "candidatesTokenCount": 2,
                    "totalTokenCount": 8,
                },
            },
        )

    result = run_with_transport(model, handler, max_output_tokens=1024)
    assert result.response == "Hi there"
    assert (result.input_tokens, result.output_tokens, result.total_tokens) == (6, 2, 8)
    assert result.finish_reason == "STOP"


def test_configuration_errors_happen_before_provider_request() -> None:
    async def run(model):
        return await generate_prompt(model, "Hello", None)

    with pytest.raises(
        PlaygroundConfigurationError, match="requires configured credentials"
    ):
        asyncio.run(run(model_configuration("openai")))
    with pytest.raises(PlaygroundConfigurationError, match="requires a base URL"):
        asyncio.run(run(model_configuration("openai_compatible")))
    with pytest.raises(PlaygroundConfigurationError, match="executable protocol"):
        asyncio.run(run(model_configuration("custom")))


@pytest.mark.parametrize(
    ("status_code", "payload", "expected_code", "expected_message"),
    [
        (
            401,
            {"error": {"message": "test-secret", "type": "authentication_error"}},
            "invalid_api_key",
            "API key",
        ),
        (429, {"error": {"code": "rate_limit_error"}}, "rate_limit", "rate limit"),
        (
            503,
            {"error": {"status": "UNAVAILABLE"}},
            "provider_unavailable",
            "unavailable",
        ),
        (504, {"error": {"status": "DEADLINE_EXCEEDED"}}, "timeout", "timed out"),
        (
            400,
            {"error": {"code": "model_not_found"}},
            "unsupported_model",
            "unsupported",
        ),
        (403, {"error": {"message": "test-secret"}}, "provider_error", "HTTP 403"),
        (404, {"error": {"message": "test-secret"}}, "provider_error", "HTTP 404"),
    ],
)
def test_provider_http_failures_are_classified_without_response_body(
    status_code: int, payload: dict, expected_code: str, expected_message: str
) -> None:
    model = model_configuration("openai", api_key="test-secret")

    def rejected(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code,
            request=request,
            json=payload,
        )

    with pytest.raises(PlaygroundProviderError) as error:
        run_with_transport(model, rejected)
    assert error.value.code == expected_code
    assert expected_message in str(error.value)
    assert "test-secret" not in str(error.value)


def test_provider_failures_classify_transport_and_malformed_responses() -> None:
    model = model_configuration("openai", api_key="test-secret")

    def times_out(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(PlaygroundTimeoutError) as error:
        run_with_transport(model, times_out)
    assert error.value.code == "timeout"

    def unavailable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("test-secret", request=request)

    with pytest.raises(PlaygroundProviderError) as error:
        run_with_transport(model, unavailable)
    assert error.value.code == "provider_unavailable"
    assert "test-secret" not in str(error.value)

    def malformed(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    with pytest.raises(PlaygroundProviderError, match="empty response") as error:
        run_with_transport(model, malformed)
    assert error.value.code == "malformed_response"

    def invalid_object(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    with pytest.raises(
        PlaygroundProviderError, match="invalid response object"
    ) as error:
        run_with_transport(model, invalid_object)
    assert error.value.code == "malformed_response"

    def invalid_json(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json")

    with pytest.raises(PlaygroundProviderError) as error:
        run_with_transport(model, invalid_json)
    assert error.value.code == "malformed_response"


def test_provider_response_size_is_bounded() -> None:
    model = model_configuration(
        "ollama",
        base_url="http://ollama.test",
    )

    def oversized(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * (MAX_PROVIDER_RESPONSE_BYTES + 1))

    with pytest.raises(PlaygroundProviderError, match="safe size limit") as error:
        run_with_transport(model, oversized)
    assert error.value.code == "malformed_response"
