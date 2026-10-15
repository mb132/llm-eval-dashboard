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


def _preview(client: TestClient, source: str, import_options: dict[str, object]):
    data, files = multipart("cases.csv", source, import_options)
    return client.post("/api/datasets/import/preview", data=data, files=files)


def test_replace_keeps_last_in_upload_duplicate(prompt_client: TestClient) -> None:
    created = prompt_client.post(
        "/api/datasets",
        json={
            "name": "Existing",
            "test_case": {"input": "Same", "expected_answer": "old"},
        },
    ).json()
    dataset_id = created["id"]
    source = "input,expected_answer\nSame,first\nOther,x\nSame,last\n"
    import_options = options(
        destination={"mode": "existing", "dataset_id": dataset_id}, action="replace"
    )
    preview = _preview(prompt_client, source, import_options)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    first, other, last = body["rows"]
    assert first["status"] == "skip"
    assert first["reason"] == "A later uploaded duplicate will replace this row."
    assert other["status"] == "add"
    assert last["status"] == "replace"
    assert last["case"]["expected_answer"] == "last"
    assert body["counts"] == {
        "add": 1,
        "replace": 1,
        "unchanged": 0,
        "skip": 1,
        "invalid": 0,
        "final": 2,
    }

    data, files = multipart(
        "cases.csv",
        source,
        import_options,
        fingerprint=body["fingerprint"],
        import_id=str(uuid4()),
    )
    committed = prompt_client.post(
        "/api/datasets/import/commit", data=data, files=files
    )
    assert committed.status_code == 201, committed.text
    cases = prompt_client.get(f"/api/datasets/{dataset_id}").json()["test_cases"]
    answers = {case["input"]: case["expected_answer"] for case in cases}
    assert answers == {"Same": "last", "Other": "x"}


def test_replace_in_upload_duplicates_into_new_dataset(
    prompt_client: TestClient,
) -> None:
    source = "input,expected_answer\nSame,first\nSame,last\n"
    import_options = options(
        destination={"mode": "new", "name": "Dupes", "description": None},
        action="replace",
    )
    body = _preview(prompt_client, source, import_options).json()
    assert [row["status"] for row in body["rows"]] == ["skip", "add"]
    assert body["counts"]["add"] == 1
    assert body["counts"]["skip"] == 1
    assert body["counts"]["final"] == 1
    data, files = multipart(
        "cases.csv",
        source,
        import_options,
        fingerprint=body["fingerprint"],
        import_id=str(uuid4()),
    )
    committed = prompt_client.post(
        "/api/datasets/import/commit", data=data, files=files
    )
    assert committed.status_code == 201, committed.text
    cases = prompt_client.get(f"/api/datasets/{committed.json()['dataset_id']}").json()[
        "test_cases"
    ]
    assert [case["expected_answer"] for case in cases] == ["last"]


def test_skip_and_keep_in_upload_duplicates_are_unchanged(
    prompt_client: TestClient,
) -> None:
    source = "input,expected_answer\nSame,first\nSame,last\n"
    destination: dict[str, object] = {
        "mode": "new",
        "name": "Dupes",
        "description": None,
    }
    skip = _preview(prompt_client, source, options(destination=destination)).json()
    assert [row["status"] for row in skip["rows"]] == ["add", "skip"]
    keep = _preview(
        prompt_client, source, options(destination=destination, action="keep")
    ).json()
    assert [row["status"] for row in keep["rows"]] == ["add", "add"]
    assert keep["counts"]["add"] == 2


NEW_DESTINATION: dict[str, object] = {
    "mode": "new",
    "name": "Malformed",
    "description": None,
}


def _malformed_cases() -> list[tuple[str, dict[str, object]]]:
    base = options(destination=NEW_DESTINATION)
    return [
        ("mapping list", {**base, "mapping": []}),
        ("mapping string", {**base, "mapping": "input"}),
        ("mapping value list", {**base, "mapping": {"input": ["input"]}}),
        ("mapping value number", {**base, "mapping": {"input": 3}}),
        ("destination string", {**base, "destination": "new"}),
        ("destination list", {**base, "destination": []}),
        ("destination missing", {k: v for k, v in base.items() if k != "destination"}),
        ("destination bad mode", {**base, "destination": {"mode": "other"}}),
        (
            "destination existing without id",
            {**base, "destination": {"mode": "existing"}},
        ),
        (
            "destination existing bad id",
            {**base, "destination": {"mode": "existing", "dataset_id": 5}},
        ),
        (
            "destination name number",
            {**base, "destination": {"mode": "new", "name": 5}},
        ),
        (
            "destination description number",
            {**base, "destination": {"mode": "new", "name": "x", "description": 5}},
        ),
        ("delimiter multi-char", {**base, "delimiter": ";;"}),
        ("delimiter empty", {**base, "delimiter": ""}),
        ("delimiter number", {**base, "delimiter": 1}),
        ("delimiter quote", {**base, "delimiter": '"'}),
        ("delimiter newline", {**base, "delimiter": "\n"}),
        ("duplicate_action unknown", {**base, "duplicate_action": "merge"}),
        ("duplicate_action list", {**base, "duplicate_action": []}),
        ("duplicate_action null", {**base, "duplicate_action": None}),
        ("invalid_policy unknown", {**base, "invalid_policy": "lenient"}),
        ("invalid_policy number", {**base, "invalid_policy": 1}),
    ]


def test_malformed_import_options_return_422_not_500(
    prompt_client: TestClient,
) -> None:
    source = "input,expected_answer\nQ,A\n"
    for label, bad_options in _malformed_cases():
        preview = _preview(prompt_client, source, bad_options)
        assert preview.status_code == 422, (label, preview.status_code, preview.text)
        assert isinstance(preview.json()["detail"], str), label
        data, files = multipart(
            "cases.csv",
            source,
            bad_options,
            fingerprint="x",
            import_id=str(uuid4()),
        )
        commit = prompt_client.post(
            "/api/datasets/import/commit", data=data, files=files
        )
        assert commit.status_code == 422, (label, commit.status_code, commit.text)


def test_well_formed_options_accepted(prompt_client: TestClient) -> None:
    base = options(destination=NEW_DESTINATION)
    # What the UI sends: empty mapping, no delimiter, explicit policies.
    assert (
        _preview(prompt_client, "input,expected_answer\nQ,A\n", base).status_code == 200
    )
    explicit = {
        **base,
        "mapping": {"input": "q", "expected_answer": "a", "category": None},
        "delimiter": ";",
        "invalid_policy": "valid_only",
    }
    response = _preview(prompt_client, "q;a\nQ;A\n", explicit)
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["add"] == 1
    # Unknown mapping targets are ignored, as before.
    ignored = {
        **base,
        "mapping": {
            "input": "input",
            "expected_answer": "expected_answer",
            "bogus": "x",
        },
    }
    assert (
        _preview(prompt_client, "input,expected_answer\nQ,A\n", ignored).status_code
        == 200
    )
