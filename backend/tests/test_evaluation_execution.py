"""Integration tests for persistent evaluation execution and retrieval."""

import asyncio
from uuid import UUID

from app.api import evaluations
from app.models import EvaluationResult
from app.services.evaluation_execution import (
    execute_evaluation_run,
    fail_interrupted_runs,
)
from app.services.ollama import OllamaError, OllamaResult
from app.services.playground import PlaygroundResult
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

MODEL_ID = "1"


def create_inputs(client: TestClient, *, second_case: bool = True) -> tuple[str, str]:
    """Create one prompt version and a dataset for execution tests."""
    if not client.get("/api/models").json():
        model = client.post(
            "/api/models",
            json={
                "display_name": "Local model",
                "provider": "ollama",
                "model_name": "test-model:latest",
                "base_url": "http://localhost:11434",
            },
        )
        assert model.status_code == 201
    prompt = client.post(
        "/api/prompts",
        json={
            "name": "Execution prompt",
            "description": None,
            "content": "Answer this exactly: {{input}}",
        },
    ).json()
    dataset = client.post(
        "/api/datasets",
        json={
            "name": "Execution dataset",
            "description": None,
            "test_case": {
                "input": "Capital of France?",
                "expected_answer": "Paris",
            },
        },
    ).json()
    if second_case:
        client.post(
            f"/api/datasets/{dataset['id']}/test-cases",
            json={"input": "2 + 2?", "expected_answer": "4"},
        )
    return prompt["versions"][0]["id"], dataset["id"]


def configuration(version_id: str, dataset_id: str, repetitions: int = 1):
    """Return a valid F05 request payload."""
    return {
        "model_ids": [MODEL_ID],
        "prompt_version_ids": [version_id],
        "dataset_id": dataset_id,
        "repetitions": repetitions,
    }


def disable_background_execution(
    monkeypatch,
) -> list[UUID]:
    """Replace the scheduled worker while retaining BackgroundTasks behavior."""
    scheduled: list[UUID] = []

    async def record_execution(evaluation_id: UUID, **kwargs) -> None:
        scheduled.append(evaluation_id)

    monkeypatch.setattr(evaluations, "execute_evaluation_run", record_execution)
    return scheduled


def test_start_persists_complete_immutable_request_plan(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Persist every rendered combination before scheduling provider work."""
    scheduled = disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client)

    response = prompt_client.post(
        "/api/evaluations",
        json=configuration(version_id, dataset_id, repetitions=2),
    )

    assert response.status_code == 202
    run = response.json()
    assert run["status"] == "pending"
    assert run["total_requests"] == 4
    assert scheduled == [UUID(run["id"])]

    async def load_results() -> list[EvaluationResult]:
        async with evaluation_session_factory() as session:
            statement = select(EvaluationResult).order_by(
                EvaluationResult.sequence_number
            )
            return list(await session.scalars(statement))

    stored = asyncio.run(load_results())
    assert len(stored) == 4
    assert [item.repetition for item in stored] == [1, 2, 1, 2]
    assert stored[0].rendered_prompt == "Answer this exactly: Capital of France?"
    assert all("{{input}}" not in item.rendered_prompt for item in stored)
    assert stored[0].expected_output == "Paris"
    assert stored[0].max_output_tokens == 1024

    first_page = prompt_client.get(f"/api/evaluations/{run['id']}/results?limit=1")
    assert first_page.status_code == 200
    assert first_page.json()["total"] == 4
    assert len(first_page.json()["items"]) == 1
    assert (
        prompt_client.get(f"/api/evaluations/{run['id']}/results?limit=101").status_code
        == 422
    )


def test_execution_completes_with_individual_provider_failure(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Store one failed request without aborting other test cases."""
    disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client)
    run = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    ).json()

    async def fake_provider(prompt: str, model: str, **kwargs) -> OllamaResult:
        assert model
        if "2 + 2?" in prompt:
            raise OllamaError("Synthetic provider failure.", code="synthetic")
        return OllamaResult(
            model=model,
            response="Paris",
            latency_ms=12,
            input_tokens=None,
            output_tokens=1,
        )

    async def execute() -> None:
        await execute_evaluation_run(
            UUID(run["id"]),
            session_factory=evaluation_session_factory,
            provider_call=fake_provider,
            semaphore=asyncio.Semaphore(2),
        )

    asyncio.run(execute())

    persisted = prompt_client.get(f"/api/evaluations/{run['id']}").json()
    assert persisted["status"] == "completed"
    assert persisted["completed_requests"] == 2
    assert persisted["successful_requests"] == 1
    assert persisted["failed_requests"] == 1
    results = prompt_client.get(f"/api/evaluations/{run['id']}/results").json()["items"]
    assert [item["status"] for item in results] == ["succeeded", "failed"]
    assert results[0]["generated_output"] == "Paris"
    assert results[0]["input_tokens"] is None
    assert results[1]["error_code"] == "synthetic"
    assert results[1]["error_message"] == "Synthetic provider failure."


def test_execution_uses_the_persisted_model_configuration(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Dispatch evaluation requests through the selected configured model."""
    disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client, second_case=False)
    run = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    ).json()

    async def fake_generate(model, prompt, system_prompt, *, client):
        assert model.id == 1
        assert model.display_name == "Local model"
        assert model.provider == "ollama"
        assert model.model_name == "test-model:latest"
        assert model.base_url == "http://localhost:11434"
        assert prompt == "Answer this exactly: Capital of France?"
        assert system_prompt is None
        assert client is not None
        return PlaygroundResult(
            response="Paris",
            latency_ms=8,
            input_tokens=6,
            output_tokens=1,
            total_tokens=7,
            finish_reason="stop",
        )

    monkeypatch.setattr(
        "app.services.evaluation_execution.generate_prompt", fake_generate
    )
    asyncio.run(
        execute_evaluation_run(
            UUID(run["id"]),
            session_factory=evaluation_session_factory,
            semaphore=asyncio.Semaphore(1),
        )
    )

    results = prompt_client.get(f"/api/evaluations/{run['id']}/results").json()
    assert results["items"][0]["status"] == "succeeded"
    assert results["items"][0]["generated_output"] == "Paris"
    assert results["items"][0]["reported_model_name"] == "test-model:latest"


def test_unexpected_execution_error_fails_run_without_leaking_details(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Fail unfinished work with a stable public error on orchestration faults."""
    disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client, second_case=False)
    run = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    ).json()

    async def broken_provider(prompt: str, model: str, **kwargs) -> OllamaResult:
        raise RuntimeError("database-password-should-not-leak")

    async def execute() -> None:
        await execute_evaluation_run(
            UUID(run["id"]),
            session_factory=evaluation_session_factory,
            provider_call=broken_provider,
            semaphore=asyncio.Semaphore(1),
        )

    asyncio.run(execute())

    persisted = prompt_client.get(f"/api/evaluations/{run['id']}").json()
    assert persisted["status"] == "failed"
    assert persisted["failure_message"] == (
        "The evaluation was interrupted by an internal execution error."
    )
    assert "database-password" not in str(persisted)


def test_restart_reconciliation_marks_pending_results_failed(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Do not replay requests whose previous execution state is unknown."""
    disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client)
    run = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    ).json()

    asyncio.run(fail_interrupted_runs(evaluation_session_factory))

    persisted = prompt_client.get(f"/api/evaluations/{run['id']}").json()
    assert persisted["status"] == "failed"
    assert persisted["completed_requests"] == 2
    assert persisted["failed_requests"] == 2
    assert persisted["failure_message"] == (
        "The evaluation was interrupted by a server restart."
    )


def test_execution_endpoints_return_not_found(prompt_client: TestClient) -> None:
    """Return a stable 404 for unknown persisted runs."""
    missing_id = "87ad64a0-6206-4921-a102-92b75fc25188"
    assert prompt_client.get(f"/api/evaluations/{missing_id}").status_code == 404
    assert (
        prompt_client.get(f"/api/evaluations/{missing_id}/results").status_code == 404
    )
