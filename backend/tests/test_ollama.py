import asyncio

import httpx
from app.services.ollama import run_evaluation


def test_run_evaluation_calls_generate_and_extracts_metrics(monkeypatch) -> None:
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama.test/")
    monkeypatch.setenv("OLLAMA_MODEL", "gemma4:e4b")

    def handle_request(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://ollama.test/api/generate"
        assert request.read()
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
            return await run_evaluation("Be concise.", "Capital?", client=client)

    result = asyncio.run(run_test())

    assert result.model == "gemma4:e4b"
    assert result.response == "Paris"
    assert result.latency_ms >= 0
    assert result.input_tokens == 18
    assert result.output_tokens == 3
