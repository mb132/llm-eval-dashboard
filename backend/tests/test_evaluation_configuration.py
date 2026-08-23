"""Integration tests for evaluation configuration and preview validation."""

from collections.abc import Iterator

import pytest
from app.main import app
from app.services.evaluation_configuration import (
    ModelOption,
    get_evaluation_model_options,
)
from fastapi.testclient import TestClient

PROMPT_CONTENT = "Answer accurately:\n{{input}}"


@pytest.fixture
def two_model_client(prompt_client: TestClient) -> Iterator[TestClient]:
    """Expose two fake normalized models without depending on a live provider."""

    def fake_model_options() -> list[ModelOption]:
        return [
            ModelOption(id="model-a", provider="ollama", name="Model A"),
            ModelOption(id="model-b", provider="ollama", name="Model B"),
        ]

    app.dependency_overrides[get_evaluation_model_options] = fake_model_options
    try:
        yield prompt_client
    finally:
        app.dependency_overrides.pop(get_evaluation_model_options, None)


def create_prompt_with_two_versions(client: TestClient) -> tuple[str, str]:
    """Create one prompt and return both immutable version IDs."""
    prompt = client.post(
        "/api/prompts",
        json={
            "name": "Evaluation prompt",
            "description": None,
            "content": PROMPT_CONTENT,
        },
    ).json()
    second = client.post(
        f"/api/prompts/{prompt['id']}/versions",
        json={"content": "Be concise.\n{{input}}"},
    ).json()
    return prompt["versions"][0]["id"], second["id"]


def create_dataset_with_two_cases(client: TestClient) -> str:
    """Create one dataset with two cases and return its ID."""
    dataset = client.post(
        "/api/datasets",
        json={
            "name": "Evaluation dataset",
            "description": None,
            "test_case": {
                "input": "Capital of France?",
                "expected_answer": "Paris",
            },
        },
    ).json()
    client.post(
        f"/api/datasets/{dataset['id']}/test-cases",
        json={"input": "2 + 2?", "expected_answer": "4"},
    )
    return dataset["id"]


def test_options_expose_normalized_ollama_without_server_configuration(
    prompt_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Return selectable data without leaking URLs or other server settings."""
    monkeypatch.setenv("OLLAMA_MODEL", "local-model")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://private-provider.internal")
    first_version_id, second_version_id = create_prompt_with_two_versions(prompt_client)
    dataset_id = create_dataset_with_two_cases(prompt_client)

    response = prompt_client.get("/api/evaluations/options")

    assert response.status_code == 200
    body = response.json()
    assert body["models"] == [
        {"id": "ollama-default", "provider": "ollama", "name": "local-model"}
    ]
    assert [item["id"] for item in body["prompt_versions"]] == [
        second_version_id,
        first_version_id,
    ]
    assert body["datasets"] == [
        {
            "id": dataset_id,
            "name": "Evaluation dataset",
            "test_case_count": 2,
        }
    ]
    serialized = response.text
    assert "private-provider.internal" not in serialized
    assert "OLLAMA_BASE_URL" not in serialized


def test_preview_supports_multiple_models_and_prompt_versions(
    two_model_client: TestClient,
) -> None:
    """Calculate the Cartesian product and repetition count exactly."""
    version_ids = create_prompt_with_two_versions(two_model_client)
    dataset_id = create_dataset_with_two_cases(two_model_client)

    response = two_model_client.post(
        "/api/evaluations/preview",
        json={
            "model_ids": ["model-a", "model-b"],
            "prompt_version_ids": list(version_ids),
            "dataset_id": dataset_id,
            "repetitions": 2,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "model_ids": ["model-a", "model-b"],
        "prompt_version_ids": list(version_ids),
        "dataset_id": dataset_id,
        "repetitions": 2,
        "model_count": 2,
        "prompt_version_count": 2,
        "test_case_count": 2,
        "combination_count": 4,
        "total_requests": 16,
    }


@pytest.mark.parametrize(
    "payload",
    [
        {
            "model_ids": [],
            "prompt_version_ids": ["87ad64a0-6206-4921-a102-92b75fc25188"],
            "dataset_id": "1e9df267-fd16-46aa-bad8-82d91b4481fc",
        },
        {
            "model_ids": ["model-a", "model-a"],
            "prompt_version_ids": ["87ad64a0-6206-4921-a102-92b75fc25188"],
            "dataset_id": "1e9df267-fd16-46aa-bad8-82d91b4481fc",
        },
        {
            "model_ids": ["model-a"],
            "prompt_version_ids": [
                "87ad64a0-6206-4921-a102-92b75fc25188",
                "87ad64a0-6206-4921-a102-92b75fc25188",
            ],
            "dataset_id": "1e9df267-fd16-46aa-bad8-82d91b4481fc",
        },
        {
            "model_ids": ["model-a"],
            "prompt_version_ids": ["87ad64a0-6206-4921-a102-92b75fc25188"],
            "dataset_id": "1e9df267-fd16-46aa-bad8-82d91b4481fc",
            "repetitions": 0,
        },
        {
            "model_ids": ["model-a"],
            "prompt_version_ids": ["87ad64a0-6206-4921-a102-92b75fc25188"],
            "dataset_id": "1e9df267-fd16-46aa-bad8-82d91b4481fc",
            "temperature": 0.5,
        },
    ],
)
def test_preview_rejects_invalid_request_shapes(
    two_model_client: TestClient,
    payload: dict[str, object],
) -> None:
    """Reject empty, duplicate, out-of-range, and unknown request fields."""
    response = two_model_client.post("/api/evaluations/preview", json=payload)

    assert response.status_code == 422


def test_preview_rejects_stale_selections(two_model_client: TestClient) -> None:
    """Reject model and prompt IDs that are not currently selectable."""
    version_ids = create_prompt_with_two_versions(two_model_client)
    dataset_id = create_dataset_with_two_cases(two_model_client)
    unknown_model = two_model_client.post(
        "/api/evaluations/preview",
        json={
            "model_ids": ["removed-model"],
            "prompt_version_ids": [version_ids[0]],
            "dataset_id": dataset_id,
        },
    )
    unknown_prompt = two_model_client.post(
        "/api/evaluations/preview",
        json={
            "model_ids": ["model-a"],
            "prompt_version_ids": ["87ad64a0-6206-4921-a102-92b75fc25188"],
            "dataset_id": dataset_id,
        },
    )

    assert unknown_model.status_code == 422
    assert unknown_model.json() == {
        "detail": "One or more selected models are no longer available."
    }
    assert unknown_prompt.status_code == 422
    assert unknown_prompt.json() == {
        "detail": "One or more selected prompt versions no longer exist."
    }


def test_preview_rejects_missing_dataset(two_model_client: TestClient) -> None:
    """Return not found when the selected dataset no longer exists."""
    version_ids = create_prompt_with_two_versions(two_model_client)
    response = two_model_client.post(
        "/api/evaluations/preview",
        json={
            "model_ids": ["model-a"],
            "prompt_version_ids": [version_ids[0]],
            "dataset_id": "1e9df267-fd16-46aa-bad8-82d91b4481fc",
        },
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Dataset not found."}


def test_preview_bounds_total_model_requests(
    two_model_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Reject configurations above the server-side request budget."""
    monkeypatch.setattr(
        "app.services.evaluation_configuration.MAX_TOTAL_REQUESTS",
        5,
    )
    version_ids = create_prompt_with_two_versions(two_model_client)
    dataset_id = create_dataset_with_two_cases(two_model_client)
    response = two_model_client.post(
        "/api/evaluations/preview",
        json={
            "model_ids": ["model-a", "model-b"],
            "prompt_version_ids": list(version_ids),
            "dataset_id": dataset_id,
        },
    )

    assert response.status_code == 422
    assert "at most 5 requests" in response.json()["detail"]
