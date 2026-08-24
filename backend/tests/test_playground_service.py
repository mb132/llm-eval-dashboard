import asyncio
import json

import httpx
import pytest
from app.models import ModelConfiguration
from app.services.playground import (
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
    api_key_env_var: str | None = None,
    parameters: dict | None = None,
) -> ModelConfiguration:
    return ModelConfiguration(
        display_name=provider.title(),
        provider=provider,
        model_name=model_name,
        base_url=base_url,
        api_key_env_var=api_key_env_var,
        parameters=parameters or {"temperature": 0.2},
    )


def run_with_transport(model, handler, *, system_prompt="Be concise."):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await generate_prompt(
                model,
                "Hello",
                system_prompt,
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
            "options": {"temperature": 0.2},
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

    result = run_with_transport(model, handler)
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
    if credential_name:
        monkeypatch.setenv(credential_name, "test-secret")
    model = model_configuration(
        provider,
        base_url=base_url,
        api_key_env_var=credential_name,
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
                    "total_tokens": 9,
                },
            },
        )

    result = run_with_transport(model, handler)
    assert result.response == "Hi!"
    assert (result.input_tokens, result.output_tokens, result.total_tokens) == (7, 2, 9)


def test_anthropic_adapter_uses_required_headers_and_default_limit(monkeypatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-secret")
    model = model_configuration(
        "anthropic",
        api_key_env_var="ANTHROPIC_API_KEY",
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

    result = run_with_transport(model, handler)
    assert result.response == "Hello!"
    assert (
        result.input_tokens,
        result.output_tokens,
        result.total_tokens,
    ) == (8, 3, 11)
    assert result.finish_reason == "end_turn"


def test_gemini_adapter_builds_generate_content_request(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret")
    model = model_configuration(
        "gemini",
        model_name="models/gemini-test",
        api_key_env_var="GEMINI_API_KEY",
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
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 500},
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

    result = run_with_transport(model, handler)
    assert result.response == "Hi there"
    assert (result.input_tokens, result.output_tokens, result.total_tokens) == (6, 2, 8)
    assert result.finish_reason == "STOP"


def test_configuration_errors_happen_before_provider_request(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    async def run(model):
        return await generate_prompt(model, "Hello", None)

    with pytest.raises(PlaygroundConfigurationError, match="not set"):
        asyncio.run(
            run(model_configuration("openai", api_key_env_var="OPENAI_API_KEY"))
        )
    with pytest.raises(PlaygroundConfigurationError, match="require a base URL"):
        asyncio.run(run(model_configuration("openai_compatible")))
    with pytest.raises(PlaygroundConfigurationError, match="executable protocol"):
        asyncio.run(run(model_configuration("custom")))


def test_provider_failures_are_normalized_without_response_body(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    model = model_configuration("openai", api_key_env_var="OPENAI_API_KEY")

    def rejected(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            request=request,
            json={"error": "test-secret should never escape"},
        )

    with pytest.raises(PlaygroundProviderError) as error:
        run_with_transport(model, rejected)
    assert "HTTP 401" in str(error.value)
    assert "test-secret" not in str(error.value)

    def times_out(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(PlaygroundTimeoutError):
        run_with_transport(model, times_out)

    def malformed(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    with pytest.raises(PlaygroundProviderError, match="empty response"):
        run_with_transport(model, malformed)
