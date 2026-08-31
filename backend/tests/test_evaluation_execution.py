"""Integration tests for persistent evaluation execution and retrieval."""

import asyncio
from uuid import UUID

from app.api import evaluations
from app.models import EvaluationResult, ModelConfiguration
from app.services.evaluation_execution import (
    execute_evaluation_run,
    fail_interrupted_runs,
)
from app.services.ollama import OllamaError, OllamaResult
from app.services.playground import PlaygroundResult
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

MODEL_ID = "1"


def create_inputs(client: TestClient, *, second_case: bool = True) -> tuple[str, str]:
    """Create one prompt version and a dataset for execution tests."""
    if not client.get("/api/models").json():
        provider = client.post(
            "/api/providers",
            json={
                "display_name": "Local Ollama",
                "kind": "ollama",
                "base_url": "http://localhost:11434",
            },
        )
        assert provider.status_code == 201
        model = client.post(
            "/api/models",
            json={
                "display_name": "Local model",
                "provider_id": provider.json()["id"],
                "model_name": "test-model:latest",
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
            statement = (
                select(EvaluationResult)
                .order_by(EvaluationResult.sequence_number)
                .options(selectinload(EvaluationResult.quality_scores))
            )
            return list(await session.scalars(statement))

    stored = asyncio.run(load_results())
    assert len(stored) == 4
    assert [item.repetition for item in stored] == [1, 2, 1, 2]
    assert stored[0].rendered_prompt == "Answer this exactly: Capital of France?"
    assert all("{{input}}" not in item.rendered_prompt for item in stored)
    assert stored[0].expected_output == "Paris"
    assert stored[0].max_output_tokens == 1024
    assert stored[0].provider_model_name == "test-model:latest"
    assert stored[0].model_base_url == "http://localhost:11434"
    assert stored[0].provider_configuration_id == 1
    assert stored[0].model_parameters == {}
    assert {
        (score.method, score.metric_version, score.score)
        for score in stored[0].quality_scores
    } == {
        ("normalized_exact_match", 1, None),
        ("normalized_contains_match", 1, None),
    }

    first_page = prompt_client.get(f"/api/evaluations/{run['id']}/results?limit=1")
    assert first_page.status_code == 200
    assert first_page.json()["total"] == 4
    assert len(first_page.json()["items"]) == 1
    assert first_page.json()["items"][0]["total_tokens"] is None
    performance = prompt_client.get(
        f"/api/evaluations/{run['id']}/performance-summary"
    ).json()
    assert performance["latency"]["average_ms"] is None
    assert performance["latency"]["recorded_results"] == 0
    assert performance["latency"]["unavailable_results"] == 4
    assert performance["total_tokens"] == {
        "sum_tokens": None,
        "recorded_results": 0,
        "unavailable_results": 4,
    }
    assert (
        prompt_client.get(f"/api/evaluations/{run['id']}/results?limit=101").status_code
        == 422
    )


def test_evaluation_archive_lists_newest_runs_with_health_summary(
    prompt_client: TestClient,
    monkeypatch,
) -> None:
    """Expose every saved run through a bounded newest-first archive."""
    disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client, second_case=False)
    first = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    ).json()
    second = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    ).json()

    response = prompt_client.get("/api/evaluations?offset=0&limit=1")

    assert response.status_code == 200
    archive = response.json()
    assert archive["total"] == 2
    assert archive["completed"] == 0
    assert archive["failed"] == 0
    assert archive["offset"] == 0
    assert archive["limit"] == 1
    assert [item["id"] for item in archive["items"]] == [second["id"]]
    assert archive["items"][0]["models"] == [{"id": MODEL_ID, "name": "Local model"}]
    assert archive["items"][0]["prompt_versions"] == [
        {
            "id": version_id,
            "name": "Execution prompt",
            "version_number": 1,
        }
    ]
    assert first["id"] != second["id"]
    assert prompt_client.get("/api/evaluations?limit=101").status_code == 422


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
            response="The answer is PARIS.",
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
    assert results[0]["generated_output"] == "The answer is PARIS."
    assert results[0]["input_tokens"] is None
    assert {item["method"]: item["score"] for item in results[0]["quality_scores"]} == {
        "normalized_exact_match": 0.0,
        "normalized_contains_match": 1.0,
    }
    assert all(item["score"] is None for item in results[1]["quality_scores"])
    assert results[1]["error_code"] == "synthetic"
    assert results[1]["error_message"] == "Synthetic provider failure."

    summary = prompt_client.get(f"/api/evaluations/{run['id']}/quality-summary").json()
    assert [metric["method"] for metric in summary["metrics"]] == [
        "normalized_exact_match",
        "normalized_contains_match",
    ]
    exact, contains = summary["metrics"]
    assert exact["overall"] == {
        "average_score": 0.0,
        "scored_results": 1,
        "unavailable_results": 1,
    }
    assert contains["overall"] == {
        "average_score": 1.0,
        "scored_results": 1,
        "unavailable_results": 1,
    }
    assert exact["by_model"][0]["model_name"] == "Local model"
    assert exact["by_model"][0]["scored_results"] == 1
    assert exact["by_prompt_version"][0]["prompt_name"] == "Execution prompt"

    performance = prompt_client.get(
        f"/api/evaluations/{run['id']}/performance-summary"
    ).json()
    assert performance["latency"] == {
        "average_ms": 12.0,
        "minimum_ms": 12,
        "maximum_ms": 12,
        "recorded_results": 1,
        "unavailable_results": 1,
    }
    assert performance["latency_by_model"][0]["average_ms"] == 12.0
    assert performance["input_tokens"] == {
        "sum_tokens": None,
        "recorded_results": 0,
        "unavailable_results": 2,
    }
    assert performance["token_usage_by_model"] == [
        {
            "model_id": "1",
            "model_name": "Local model",
            "input_tokens": {
                "sum_tokens": None,
                "recorded_results": 0,
                "unavailable_results": 2,
            },
            "output_tokens": {
                "sum_tokens": 1,
                "recorded_results": 1,
                "unavailable_results": 1,
            },
            "total_tokens": {
                "sum_tokens": None,
                "recorded_results": 0,
                "unavailable_results": 2,
            },
        }
    ]
    assert performance["output_tokens"] == {
        "sum_tokens": 1,
        "recorded_results": 1,
        "unavailable_results": 1,
    }
    assert performance["total_tokens"] == {
        "sum_tokens": None,
        "recorded_results": 0,
        "unavailable_results": 2,
    }


def test_execution_uses_the_persisted_model_configuration(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Dispatch evaluation requests through the selected configured model."""
    disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client, second_case=False)
    configured = prompt_client.patch(
        "/api/models/1",
        json={
            "parameters": {"num_predict": 500},
            "pricing": {
                "mode": "manual",
                "input_usd_per_million_tokens": "2",
                "output_usd_per_million_tokens": "10",
            },
        },
    )
    assert configured.status_code == 200
    run = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    ).json()

    updated = prompt_client.patch(
        "/api/models/1",
        json={
            "display_name": "Changed model",
            "model_name": "changed-model:latest",
            "parameters": {"temperature": 0.9},
            "active": False,
        },
    )
    assert updated.status_code == 200
    provider_updated = prompt_client.patch(
        "/api/providers/1", json={"base_url": "http://changed.test:11434"}
    )
    assert provider_updated.status_code == 200
    assert prompt_client.delete("/api/models/1").status_code == 204

    async def fake_generate(model, prompt, system_prompt, *, max_output_tokens, client):
        assert model.id == 1
        assert model.display_name == "Local model"
        assert model.provider.kind == "ollama"
        assert model.model_name == "test-model:latest"
        assert model.provider.base_url == "http://localhost:11434"
        assert model.parameters == {"num_predict": 500}
        assert prompt == "Answer this exactly: Capital of France?"
        assert system_prompt is None
        assert max_output_tokens == 500
        assert client is not None
        return PlaygroundResult(
            response="Paris",
            latency_ms=8,
            input_tokens=6,
            output_tokens=1,
            total_tokens=9,
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
    assert results["items"][0]["total_tokens"] == 9
    assert results["items"][0]["estimated_cost_usd"] == "0.000022000"
    assert results["items"][0]["pricing"]["source"] == "manual"

    costs = prompt_client.get(f"/api/evaluations/{run['id']}/cost-summary").json()
    assert costs == {
        "overall": {
            "estimated_usd": "0.000022000",
            "priced_results": 1,
            "unavailable_results": 0,
        },
        "average_complete_test_case_usd": "0.000022000",
        "complete_test_cases": 1,
        "incomplete_test_cases": 0,
        "by_model": [
            {
                "model_id": "1",
                "model_name": "Local model",
                "estimated_usd": "0.000022000",
                "priced_results": 1,
                "unavailable_results": 0,
            }
        ],
        "by_prompt_version": [
            {
                "prompt_version_id": version_id,
                "prompt_name": "Execution prompt",
                "prompt_version_number": 1,
                "estimated_usd": "0.000022000",
                "priced_results": 1,
                "unavailable_results": 0,
            }
        ],
    }


def test_quality_scores_group_by_model_and_prompt_version(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Aggregate compatible samples independently across both dimensions."""
    disable_background_execution(monkeypatch)
    first_version_id, dataset_id = create_inputs(prompt_client, second_case=False)
    prompt_id = prompt_client.get("/api/prompts").json()[0]["id"]
    second_version = prompt_client.post(
        f"/api/prompts/{prompt_id}/versions",
        json={"content": "Reply with only this answer: {{input}}"},
    ).json()
    second_model = prompt_client.post(
        "/api/models",
        json={
            "display_name": "Second local model",
            "provider_id": 1,
            "model_name": "second-model:latest",
        },
    ).json()
    run = prompt_client.post(
        "/api/evaluations",
        json={
            "model_ids": [MODEL_ID, str(second_model["id"])],
            "prompt_version_ids": [first_version_id, second_version["id"]],
            "dataset_id": dataset_id,
            "repetitions": 1,
        },
    ).json()

    async def fake_provider(prompt: str, model: str, **kwargs) -> OllamaResult:
        if model == "second-model:latest" and prompt.startswith(
            "Reply with only this answer:"
        ):
            raise OllamaError("Synthetic prompt/model failure.", code="synthetic")
        return OllamaResult(
            model=model,
            response="Paris",
            latency_ms=5,
            input_tokens=1,
            output_tokens=1,
        )

    asyncio.run(
        execute_evaluation_run(
            UUID(run["id"]),
            session_factory=evaluation_session_factory,
            provider_call=fake_provider,
            semaphore=asyncio.Semaphore(2),
        )
    )

    summary = prompt_client.get(f"/api/evaluations/{run['id']}/quality-summary").json()
    exact = summary["metrics"][0]
    assert len(exact["by_model"]) == 2
    assert len(exact["by_prompt_version"]) == 2
    assert {item["scored_results"] for item in exact["by_model"]} == {1, 2}
    assert {item["scored_results"] for item in exact["by_prompt_version"]} == {1, 2}

    performance = prompt_client.get(
        f"/api/evaluations/{run['id']}/performance-summary"
    ).json()
    assert performance["latency"] == {
        "average_ms": 5.0,
        "minimum_ms": 5,
        "maximum_ms": 5,
        "recorded_results": 3,
        "unavailable_results": 1,
    }
    assert len(performance["latency_by_model"]) == 2
    assert {item["recorded_results"] for item in performance["latency_by_model"]} == {
        1,
        2,
    }
    assert performance["total_tokens"] == {
        "sum_tokens": 6,
        "recorded_results": 3,
        "unavailable_results": 1,
    }
    assert len(performance["token_usage_by_model"]) == 2
    assert {
        item["total_tokens"]["sum_tokens"]
        for item in performance["token_usage_by_model"]
    } == {2, 4}
    assert len(performance["latency_by_prompt_version"]) == 2
    assert {
        item["recorded_results"] for item in performance["latency_by_prompt_version"]
    } == {1, 2}
    assert len(performance["token_usage_by_prompt_version"]) == 2
    assert {
        item["total_tokens"]["sum_tokens"]
        for item in performance["token_usage_by_prompt_version"]
    } == {2, 4}

    costs = prompt_client.get(f"/api/evaluations/{run['id']}/cost-summary").json()
    assert len(costs["by_prompt_version"]) == 2
    assert {item["unavailable_results"] for item in costs["by_prompt_version"]} == {2}


def test_security_results_score_and_group_with_unavailable_in_denominator(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Score security snapshots across models and prompts without hiding errors."""
    disable_background_execution(monkeypatch)
    first_version_id, dataset_id = create_inputs(prompt_client, second_case=False)
    dataset = prompt_client.get(f"/api/datasets/{dataset_id}").json()
    test_case_id = dataset["test_cases"][0]["id"]
    converted = prompt_client.patch(
        f"/api/datasets/{dataset_id}/test-cases/{test_case_id}",
        json={
            "case_type": "security",
            "security_test_type": "instruction_override",
            "expected_answer": "SECURITY_TEST_FAILED",
        },
    )
    assert converted.status_code == 200
    prompt_id = prompt_client.get("/api/prompts").json()[0]["id"]
    second_version = prompt_client.post(
        f"/api/prompts/{prompt_id}/versions",
        json={"content": "Refuse unsafe instructions: {{input}}"},
    ).json()
    second_model = prompt_client.post(
        "/api/models",
        json={
            "display_name": "Second local model",
            "provider_id": 1,
            "model_name": "second-model:latest",
        },
    ).json()
    run = prompt_client.post(
        "/api/evaluations",
        json={
            "model_ids": [MODEL_ID, str(second_model["id"])],
            "prompt_version_ids": [first_version_id, second_version["id"]],
            "dataset_id": dataset_id,
            "repetitions": 1,
        },
    ).json()

    async def fake_provider(prompt: str, model: str, **kwargs) -> OllamaResult:
        if model == "second-model:latest" and prompt.startswith("Refuse"):
            raise OllamaError("Synthetic provider failure.", code="synthetic")
        response = (
            "SECURITY_TEST_FAILED"
            if model == "second-model:latest"
            else "I cannot follow that instruction."
        )
        return OllamaResult(
            model=model,
            response=response,
            latency_ms=5,
            input_tokens=1,
            output_tokens=1,
        )

    asyncio.run(
        execute_evaluation_run(
            UUID(run["id"]),
            session_factory=evaluation_session_factory,
            provider_call=fake_provider,
            semaphore=asyncio.Semaphore(2),
        )
    )

    results = prompt_client.get(f"/api/evaluations/{run['id']}/results").json()["items"]
    assert {item["case_type"] for item in results} == {"security"}
    assert {item["security_test_type"] for item in results} == {"instruction_override"}
    assert [item["security_status"] for item in results].count("passed") == 2
    assert [item["security_status"] for item in results].count("failed") == 1
    assert [item["security_status"] for item in results].count("unavailable") == 1
    assert all(item["quality_scores"] == [] for item in results)

    summary = prompt_client.get(f"/api/evaluations/{run['id']}/security-summary").json()
    assert summary["metric_version"] == 1
    assert summary["overall"] == {
        "score": 0.5,
        "total_tests": 4,
        "passed_tests": 2,
        "failed_tests": 1,
        "unavailable_tests": 1,
    }
    assert len(summary["by_model"]) == 2
    assert len(summary["by_prompt_version"]) == 2
    assert {item["total_tests"] for item in summary["by_model"]} == {2}

    quality = prompt_client.get(f"/api/evaluations/{run['id']}/quality-summary").json()
    assert all(
        metric["overall"]["scored_results"] == 0 for metric in quality["metrics"]
    )
    assert all(
        metric["overall"]["unavailable_results"] == 0 for metric in quality["metrics"]
    )


def test_start_rejects_invalid_legacy_model_parameters(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    """Revalidate configurations that may predate the current API boundary."""
    disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client, second_case=False)

    async def corrupt_parameters() -> None:
        async with evaluation_session_factory() as session:
            model = await session.get(ModelConfiguration, 1)
            assert model is not None
            model.parameters = {"value": "x" * 20_000}
            await session.commit()

    asyncio.run(corrupt_parameters())

    response = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    )
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "One or more selected models contain invalid parameters."
    )


def test_start_caps_configured_output_tokens(
    prompt_client: TestClient,
    monkeypatch,
) -> None:
    """Persist the bounded value that will be sent to the provider."""
    disable_background_execution(monkeypatch)
    version_id, dataset_id = create_inputs(prompt_client, second_case=False)
    updated = prompt_client.patch(
        "/api/models/1",
        json={"parameters": {"num_predict": 5_000}},
    )
    assert updated.status_code == 200

    run = prompt_client.post(
        "/api/evaluations", json=configuration(version_id, dataset_id)
    ).json()
    results = prompt_client.get(f"/api/evaluations/{run['id']}/results").json()
    assert results["items"][0]["max_output_tokens"] == 1_024


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
    assert (
        prompt_client.get(f"/api/evaluations/{missing_id}/quality-summary").status_code
        == 404
    )
    assert (
        prompt_client.get(f"/api/evaluations/{missing_id}/security-summary").status_code
        == 404
    )
    assert (
        prompt_client.get(
            f"/api/evaluations/{missing_id}/performance-summary"
        ).status_code
        == 404
    )
    assert (
        prompt_client.get(f"/api/evaluations/{missing_id}/cost-summary").status_code
        == 404
    )
