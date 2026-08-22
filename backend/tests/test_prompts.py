"""Integration tests for prompt management."""

import pytest
from fastapi.testclient import TestClient

PROMPT_CONTENT = "Answer this question clearly:\n\n{{input}}"


def create_prompt(
    client: TestClient,
    *,
    name: str = "General Knowledge",
    description: str | None = "Answers factual questions",
    content: str = PROMPT_CONTENT,
):
    return client.post(
        "/api/prompts",
        json={"name": name, "description": description, "content": content},
    )


def test_prompt_lifecycle_preserves_immutable_versions(
    prompt_client: TestClient,
) -> None:
    created = create_prompt(prompt_client)

    assert created.status_code == 201
    prompt = created.json()
    prompt_id = prompt["id"]
    assert prompt["name"] == "General Knowledge"
    assert "name_key" not in prompt
    assert prompt["versions"][0]["version_number"] == 1
    assert prompt["versions"][0]["content"] == PROMPT_CONTENT

    updated = prompt_client.patch(
        f"/api/prompts/{prompt_id}",
        json={"name": "  Updated   Knowledge  ", "description": ""},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Updated Knowledge"
    assert updated.json()["description"] is None
    assert len(updated.json()["versions"]) == 1

    new_content = "Use one sentence for the answer.\n{{input}}"
    version = prompt_client.post(
        f"/api/prompts/{prompt_id}/versions",
        json={"content": new_content},
    )
    assert version.status_code == 201
    assert version.json()["version_number"] == 2
    assert version.json()["content"] == new_content

    persisted = prompt_client.get(f"/api/prompts/{prompt_id}")
    assert persisted.status_code == 200
    assert [item["version_number"] for item in persisted.json()["versions"]] == [
        2,
        1,
    ]
    assert persisted.json()["versions"][1]["content"] == PROMPT_CONTENT

    prompts = prompt_client.get("/api/prompts")
    assert prompts.status_code == 200
    assert prompts.json()[0]["latest_version_number"] == 2
    assert "versions" not in prompts.json()[0]


@pytest.mark.parametrize(
    "content",
    [
        "",
        "   ",
        "No input placeholder",
        "{{input}} and again {{input}}",
        "Use {{question}} instead",
        "Use {{ input }} instead",
    ],
)
def test_prompt_content_validation(prompt_client: TestClient, content: str) -> None:
    response = create_prompt(prompt_client, content=content)

    assert response.status_code == 422
    assert prompt_client.get("/api/prompts").json() == []


def test_normalized_prompt_names_are_unique(prompt_client: TestClient) -> None:
    first = create_prompt(prompt_client, name="Security   Review")
    duplicate = create_prompt(prompt_client, name="ｓｅｃｕｒｉｔｙ review")
    other = create_prompt(prompt_client, name="Other prompt")

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json() == {"detail": "A prompt with this name already exists."}
    rename_conflict = prompt_client.patch(
        f"/api/prompts/{other.json()['id']}",
        json={"name": " SECURITY REVIEW "},
    )
    assert rename_conflict.status_code == 409
    assert len(prompt_client.get("/api/prompts").json()) == 2


def test_prompt_errors_are_explicit_and_sanitized(prompt_client: TestClient) -> None:
    missing_id = "21c71d8a-1dc7-4efe-9d4d-134c0b72fc2e"

    assert prompt_client.get(f"/api/prompts/{missing_id}").status_code == 404
    assert prompt_client.patch(f"/api/prompts/{missing_id}", json={}).status_code == 422
    assert (
        prompt_client.post(
            f"/api/prompts/{missing_id}/versions",
            json={"content": PROMPT_CONTENT},
        ).status_code
        == 404
    )


def test_prompt_requests_reject_unknown_fields(prompt_client: TestClient) -> None:
    response = prompt_client.post(
        "/api/prompts",
        json={
            "name": "Unexpected Field",
            "content": PROMPT_CONTENT,
            "owner_id": "untrusted-client-value",
        },
    )

    assert response.status_code == 422
