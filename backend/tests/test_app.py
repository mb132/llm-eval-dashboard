from app.api import evaluations
from app.main import app
from app.services.ollama import OllamaError, OllamaResult
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_app_can_be_imported() -> None:
    assert isinstance(app, FastAPI)
    assert app.title == "LLM Evaluation Platform"


def test_run_evaluation_returns_normalized_result(monkeypatch) -> None:
    async def fake_run_evaluation(prompt: str, question: str) -> OllamaResult:
        assert "accurately" in prompt
        assert question == "What is the capital of France?"
        return OllamaResult(
            model="gemma4:e4b",
            response="Paris",
            latency_ms=842,
            input_tokens=18,
            output_tokens=3,
        )

    monkeypatch.setattr(evaluations, "run_evaluation", fake_run_evaluation)

    response = TestClient(app).post("/api/evaluations/run")

    assert response.status_code == 200
    assert response.json() == {
        "model": "gemma4:e4b",
        "response": "Paris",
        "latency_ms": 842,
        "input_tokens": 18,
        "output_tokens": 3,
    }


def test_run_evaluation_reports_ollama_error(monkeypatch) -> None:
    async def fake_run_evaluation(prompt: str, question: str) -> OllamaResult:
        raise OllamaError("Could not reach Ollama.")

    monkeypatch.setattr(evaluations, "run_evaluation", fake_run_evaluation)

    response = TestClient(app).post("/api/evaluations/run")

    assert response.status_code == 502
    assert response.json() == {"detail": "Could not reach Ollama."}
