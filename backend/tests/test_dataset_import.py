# ruff: noqa: E501
"""Dataset import/export contracts."""

import json
from uuid import uuid4

from fastapi.testclient import TestClient


def options(
    *, destination: dict[str, object], action: str = "skip"
) -> dict[str, object]:
    return {
        "destination": destination,
        "mapping": {},
        "invalid_policy": "strict",
        "duplicate_action": action,
    }


def multipart(
    file_name: str, content: str, import_options: dict[str, object], **extra: str
):
    data = {"options": json.dumps(import_options), **extra}
    return data, {"file": (file_name, content.encode(), "text/csv")}


def test_import_preview_commit_is_idempotent_and_dataset_export_round_trips(
    prompt_client: TestClient,
) -> None:
    source = 'input,expected_answer,category,metadata\nCapital of France?,Paris,geography,"{""level"":1}"\n'
    import_options = options(
        destination={"mode": "new", "name": "Imported", "description": None}
    )
    data, files = multipart("cases.csv", source, import_options)
    preview = prompt_client.post("/api/datasets/import/preview", data=data, files=files)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["can_commit"] is True
    assert body["counts"] == {
        "add": 1,
        "replace": 0,
        "unchanged": 0,
        "skip": 0,
        "invalid": 0,
        "final": 1,
    }

    import_id = str(uuid4())
    data, files = multipart(
        "cases.csv",
        source,
        import_options,
        fingerprint=body["fingerprint"],
        import_id=import_id,
    )
    committed = prompt_client.post(
        "/api/datasets/import/commit", data=data, files=files
    )
    assert committed.status_code == 201, committed.text
    repeated = prompt_client.post("/api/datasets/import/commit", data=data, files=files)
    assert repeated.status_code == 201
    assert repeated.json() == committed.json()

    dataset_id = committed.json()["dataset_id"]
    exported = prompt_client.get(f"/api/datasets/{dataset_id}/export?format=json")
    assert exported.status_code == 200
    export = exported.json()
    assert export["kind"] == "llm-eval-dataset"
    assert export["test_cases"][0]["metadata"] == {"level": 1}


def test_import_validation_and_existing_duplicate_policy(
    prompt_client: TestClient,
) -> None:
    created = prompt_client.post(
        "/api/datasets",
        json={
            "name": "Existing",
            "test_case": {"input": "Same", "expected_answer": "old"},
        },
    ).json()
    dataset_id = created["id"]
    source = "input,expected_answer\nSame,new\n,missing\n"
    import_options = options(
        destination={"mode": "existing", "dataset_id": dataset_id}, action="replace"
    )
    data, files = multipart("cases.csv", source, import_options)
    preview = prompt_client.post("/api/datasets/import/preview", data=data, files=files)
    assert preview.status_code == 200, preview.text
    assert preview.json()["can_commit"] is False
    assert preview.json()["counts"]["replace"] == 1
    assert preview.json()["counts"]["invalid"] == 1
