# ruff: noqa: E501
"""Safe, canonical CSV and JSON representations for portable application data."""

import csv
import io
import json
from datetime import UTC, datetime
from typing import Any

from ..models import Dataset, EvaluationRun, TestCase

DATASET_CSV_COLUMNS = (
    "kind",
    "schema_version",
    "text_encoding",
    "exported_at",
    "dataset_id",
    "dataset_name",
    "dataset_description",
    "filters_json",
    "id",
    "input",
    "expected_answer",
    "case_type",
    "security_test_type",
    "category",
    "metadata",
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _text(value: Any) -> Any:
    return "'" + value if isinstance(value, str) else value


def _csv(rows: list[dict[str, Any]], columns: tuple[str, ...]) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(
        stream, fieldnames=columns, extrasaction="ignore", lineterminator="\r\n"
    )
    writer.writeheader()
    for row in rows:
        writer.writerow({key: _text(value) for key, value in row.items()})
    return ("\ufeff" + stream.getvalue()).encode()


def dataset_payload(
    dataset: Dataset, cases: list[TestCase], filters: dict[str, Any]
) -> dict[str, Any]:
    return {
        "kind": "llm-eval-dataset",
        "schema_version": 1,
        "exported_at": _now(),
        "dataset": {
            "id": str(dataset.id),
            "name": dataset.name,
            "description": dataset.description,
        },
        "filters": filters,
        "test_cases": [
            {
                "id": str(item.id),
                "input": item.input,
                "expected_answer": item.expected_answer,
                "case_type": item.case_type,
                "security_test_type": item.security_test_type,
                "category": item.category,
                "metadata": item.metadata_json,
            }
            for item in cases
        ],
    }


def dataset_export(
    dataset: Dataset, cases: list[TestCase], filters: dict[str, Any], format: str
) -> tuple[bytes, str]:
    payload = dataset_payload(dataset, cases, filters)
    if format == "json":
        return json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode(), "application/json"
    rows = []
    for item in payload["test_cases"]:
        rows.append(
            {
                "kind": "llm-eval-dataset",
                "schema_version": 1,
                "text_encoding": "apostrophe-v1",
                "exported_at": payload["exported_at"],
                "dataset_id": payload["dataset"]["id"],
                "dataset_name": payload["dataset"]["name"],
                "dataset_description": payload["dataset"]["description"],
                "filters_json": json.dumps(filters, separators=(",", ":")),
                **item,
                "metadata": json.dumps(
                    item["metadata"], ensure_ascii=False, separators=(",", ":")
                )
                if item["metadata"] is not None
                else None,
            }
        )
    return _csv(rows, DATASET_CSV_COLUMNS), "text/csv; charset=utf-8"


def result_export(
    run: EvaluationRun,
    results: list[dict[str, Any]],
    filters: dict[str, Any],
    format: str,
) -> tuple[bytes, str]:
    payload = {
        "kind": "llm-eval-results",
        "schema_version": 1,
        "exported_at": _now(),
        "run": {
            "id": str(run.id),
            "status": run.status,
            "dataset_id": str(run.dataset_id),
            "dataset_name": run.dataset_name,
            "created_at": run.created_at.isoformat(),
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        },
        "filters": filters,
        "total": len(results),
        "results": results,
    }
    if format == "json":
        return json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode(), "application/json"
    csv_rows: list[dict[str, Any]] = []
    for result in results:
        row = dict(result)
        row["quality_scores_json"] = json.dumps(
            row.pop("quality_scores"), ensure_ascii=False, separators=(",", ":")
        )
        pricing = row.pop("pricing", None)
        if pricing:
            for key, value in pricing.items():
                row[f"pricing_{key}"] = value
        csv_rows.append(row)
    columns = tuple(dict.fromkeys(key for row in csv_rows for key in row))
    return _csv(csv_rows, columns), "text/csv; charset=utf-8"
