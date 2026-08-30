import asyncio
import json

import httpx
import pytest
from app.services import ollama
from app.services.ollama import OllamaError, generate_ollama_response


def test_generate_calls_ollama_and_extracts_metrics(monkeypatch) -> None:
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama.test/")
    monkeypatch.setenv("OLLAMA_MODEL", "gemma4:e4b")

    def handle_request(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://ollama.test/api/generate"
        assert json.loads(request.read()) == {
            "model": "gemma4:e4b",
            "prompt": "Be concise. Capital?",
            "stream": False,
            "options": {"num_predict": 1024},
        }
        return httpx.Response(
            200,
            json={
                "model": "gemma4:e4b",
                "response": " Paris ",
                "prompt_eval_count": 18,
                "eval_count": 3,
            },
        )

    async def run_test():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handle_request)
        ) as client:
            return await generate_ollama_response(
                "Be concise. Capital?", "gemma4:e4b", client=client
            )

    result = asyncio.run(run_test())

    assert result.model == "gemma4:e4b"
    assert result.response == " Paris "
    assert result.latency_ms >= 0
    assert result.input_tokens == 18
    assert result.output_tokens == 3
    assert result.total_tokens == 21


def test_generate_rejects_oversized_response(monkeypatch) -> None:
    """Bound provider responses before parsing untrusted JSON."""
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama.test")
    monkeypatch.setattr(ollama, "MAX_PROVIDER_RESPONSE_BYTES", 10)

    async def run_test() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"response": "too long"})
            )
        ) as client:
            with pytest.raises(OllamaError) as caught:
                await generate_ollama_response("prompt", "model", client=client)
        assert caught.value.code == "response_too_large"

    asyncio.run(run_test())


def test_generate_normalizes_invalid_metrics_and_provider_errors(monkeypatch) -> None:
    """Keep unavailable usage null and never expose raw provider error bodies."""
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama.test")

    async def run_test() -> None:
        responses = iter(
            [
                httpx.Response(
                    200,
                    json={
                        "response": "answer",
                        "prompt_eval_count": ollama.MAX_REPORTED_TOKENS + 1,
                        "eval_count": True,
                    },
                ),
                httpx.Response(500, text="secret provider diagnostic"),
            ]
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: next(responses))
        ) as client:
            result = await generate_ollama_response("prompt", "model", client=client)
            assert result.input_tokens is None
            assert result.output_tokens is None
            assert result.total_tokens is None
            with pytest.raises(OllamaError) as caught:
                await generate_ollama_response("prompt", "model", client=client)
        assert caught.value.code == "provider_http_error"
        assert "secret provider diagnostic" not in str(caught.value)

    asyncio.run(run_test())
