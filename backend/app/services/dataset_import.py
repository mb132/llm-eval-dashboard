# ruff: noqa: E501
"""Bounded parsing, validation, planning, and persistence for dataset imports."""

import csv
import hashlib
import io
import json
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import Dataset, DatasetImportReceipt, TestCase
from ..models.base import utc_now
from .datasets import (
    MAX_TEST_CASES_PER_DATASET,
    DatasetConflictError,
    DatasetNotFoundError,
    DatasetValidationError,
    normalize_dataset_name,
    normalize_description,
    validate_security_classification,
    validate_test_case_fields,
)

MAX_IMPORT_BYTES = 10 * 1024 * 1024
MAX_IMPORT_ROWS = 1_000
MAX_IMPORT_COLUMNS = 100
TARGETS = (
    "input",
    "expected_answer",
    "case_type",
    "security_test_type",
    "category",
    "metadata",
)
ALIASES = {
    "input": ("input", "question", "prompt"),
    "expected_answer": (
        "expected_answer",
        "expected_output",
        "answer",
        "response",
        "failure_marker",
    ),
    "case_type": ("case_type", "type"),
    "security_test_type": ("security_test_type",),
    "category": ("category",),
    "metadata": ("metadata",),
}


class ImportError(ValueError):
    """A safe, user-facing import error."""


@dataclass
class SourceRow:
    row_number: int
    values: dict[str, Any]


def _header_key(value: str) -> str:
    return "_".join(
        unicodedata.normalize("NFKC", value)
        .strip()
        .casefold()
        .replace("-", "_")
        .replace(" ", "_")
        .split("_")
    )


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ImportError(f"JSON object contains duplicate key '{key}'.")
        result[key] = value
    return result


def _reject_nonfinite(value: str) -> Any:
    raise ImportError("JSON numbers must be finite.")


def parse_source(
    file_name: str, content: bytes, delimiter: str | None = None
) -> tuple[list[str], list[SourceRow], dict[str, Any] | None, bool]:
    """Parse a supported source without mutating application state."""
    if len(content) > MAX_IMPORT_BYTES:
        raise ImportError("The import file must be 10 MiB or smaller.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ImportError(
            "The file must be UTF-8 encoded. Resave it as UTF-8 and try again."
        ) from exc
    suffix = file_name.rsplit(".", 1)[-1].casefold() if "." in file_name else ""
    if suffix not in {"csv", "json"}:
        raise ImportError("Only .csv and .json files are supported.")
    if suffix == "json":
        try:
            decoded = json.loads(
                text,
                object_pairs_hook=_no_duplicate_keys,
                parse_constant=_reject_nonfinite,
            )
        except (json.JSONDecodeError, ImportError) as exc:
            raise ImportError(f"Invalid JSON: {exc}") from exc
        envelope = decoded if isinstance(decoded, dict) and "kind" in decoded else None
        if envelope is not None:
            if envelope.get("kind") != "llm-eval-dataset":
                raise ImportError("This JSON file is not a dataset export.")
            if envelope.get("schema_version") != 1:
                raise ImportError(
                    "This dataset export has an unsupported schema version."
                )
            decoded = envelope.get("test_cases")
        if not isinstance(decoded, list):
            raise ImportError("JSON imports must contain an array of objects.")
        if len(decoded) > MAX_IMPORT_ROWS:
            raise ImportError(f"An import may contain at most {MAX_IMPORT_ROWS} rows.")
        if any(not isinstance(item, dict) for item in decoded):
            raise ImportError("Every JSON import row must be an object.")
        headers = list(dict.fromkeys(key for item in decoded for key in item))
        if len(headers) > MAX_IMPORT_COLUMNS:
            raise ImportError(
                f"An import may contain at most {MAX_IMPORT_COLUMNS} columns."
            )
        return (
            headers,
            [SourceRow(index + 1, item) for index, item in enumerate(decoded)],
            envelope,
            False,
        )
    try:
        dialect = (
            csv.excel
            if delimiter is None
            else type("Dialect", (csv.excel,), {"delimiter": delimiter})
        )
        reader = csv.reader(io.StringIO(text, newline=""), dialect=dialect, strict=True)
        header = next(reader, None)
        if header is None:
            raise ImportError("CSV files must contain a header row.")
        if len(header) > MAX_IMPORT_COLUMNS or not header:
            raise ImportError(f"CSV files need 1 to {MAX_IMPORT_COLUMNS} columns.")
        normalized = [_header_key(value) for value in header]
        if any(not value for value in normalized) or len(set(normalized)) != len(
            normalized
        ):
            raise ImportError(
                "CSV column names must be non-empty and unique after normalization."
            )
        rows: list[SourceRow] = []
        for physical_row, values in enumerate(reader, start=2):
            if not any(values):
                continue
            if len(rows) >= MAX_IMPORT_ROWS:
                raise ImportError(
                    f"An import may contain at most {MAX_IMPORT_ROWS} rows."
                )
            row = {
                header[index]: values[index] if index < len(values) else None
                for index in range(len(header))
            }
            if len(values) != len(header):
                row["__row_width_error__"] = True
            rows.append(SourceRow(physical_row, row))
        canonical = all(
            key in normalized
            for key in ("kind", "schema_version", "input", "expected_answer")
        )
        return header, rows, None, canonical
    except csv.Error as exc:
        raise ImportError(f"Invalid CSV: {exc}") from exc


def suggested_mapping(headers: list[str]) -> dict[str, str | None]:
    by_normalized: dict[str, list[str]] = defaultdict(list)
    for header in headers:
        by_normalized[_header_key(header)].append(header)
    suggestions: dict[str, str | None] = {}
    for target, aliases in ALIASES.items():
        candidates = [
            column for alias in aliases for column in by_normalized.get(alias, [])
        ]
        suggestions[target] = candidates[0] if len(candidates) == 1 else None
    return suggestions


def _canonical_csv_value(value: Any, encoded: bool) -> Any:
    if encoded and isinstance(value, str) and value.startswith("'"):
        return value[1:]
    return value


def _metadata(value: Any, row: int, issues: list[dict[str, Any]]) -> Any:
    if value in (None, ""):
        return None
    if isinstance(value, str):
        try:
            value = json.loads(
                value,
                object_pairs_hook=_no_duplicate_keys,
                parse_constant=_reject_nonfinite,
            )
        except (json.JSONDecodeError, ImportError):
            issues.append(
                {
                    "row_number": row,
                    "field": "metadata",
                    "code": "invalid_metadata",
                    "message": "Metadata must be a JSON object.",
                }
            )
            return None
    if not isinstance(value, dict):
        issues.append(
            {
                "row_number": row,
                "field": "metadata",
                "code": "invalid_metadata",
                "message": "Metadata must be an object.",
            }
        )
        return None
    return value


def _case(
    row: SourceRow, mapping: dict[str, str | None], canonical_encoded: bool
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    issues: list[dict[str, Any]] = []
    if row.values.get("__row_width_error__"):
        issues.append(
            {
                "row_number": row.row_number,
                "field": None,
                "code": "row_width",
                "message": "This CSV row has a different number of fields than the header.",
            }
        )
    raw: dict[str, Any] = {}
    for target, column in mapping.items():
        if column is not None and column in row.values:
            raw[target] = _canonical_csv_value(row.values[column], canonical_encoded)
    for field in ("input", "expected_answer"):
        value = raw.get(field)
        if not isinstance(value, str):
            issues.append(
                {
                    "row_number": row.row_number,
                    "field": field,
                    "code": "required",
                    "message": f"{field.replace('_', ' ').title()} is required.",
                }
            )
    case_type = raw.get("case_type") or "standard"
    raw["case_type"] = case_type
    if raw.get("security_test_type") == "":
        raw["security_test_type"] = None
    if raw.get("category") == "":
        raw["category"] = None
    raw["metadata"] = _metadata(raw.get("metadata"), row.row_number, issues)
    if issues:
        return None, issues
    try:
        case = validate_test_case_fields(raw)
        case.setdefault("case_type", "standard")
        case.setdefault("security_test_type", None)
        case.setdefault("category", None)
        case.setdefault("metadata_json", None)
        validate_security_classification(
            case_type=case["case_type"], security_test_type=case["security_test_type"]
        )
        return case, issues
    except (DatasetValidationError, TypeError) as exc:
        issues.append(
            {
                "row_number": row.row_number,
                "field": None,
                "code": "validation",
                "message": str(exc),
            }
        )
        return None, issues


def _key(case: dict[str, Any]) -> tuple[str, str, str | None]:
    return case["input"], case["case_type"], case["security_test_type"]


async def preview(
    session: AsyncSession, *, file_name: str, content: bytes, options: dict[str, Any]
) -> dict[str, Any]:
    headers, rows, envelope, canonical_csv = parse_source(
        file_name, content, options.get("delimiter")
    )
    mapping = options.get("mapping") or suggested_mapping(headers)
    mapping = {target: mapping.get(target) for target in TARGETS}
    if mapping["input"] is None or mapping["expected_answer"] is None:
        return {
            "source_columns": headers,
            "suggestions": suggested_mapping(headers),
            "mapping": mapping,
            "rows": [],
            "issues": [],
            "can_commit": False,
            "message": "Map Input and Expected answer before previewing rows.",
        }
    destination = options.get("destination", {})
    dataset: Dataset | None = None
    if destination.get("mode") == "existing":
        try:
            dataset_id = UUID(str(destination.get("dataset_id")))
        except ValueError as exc:
            raise ImportError("Choose an existing destination dataset.") from exc
        dataset = (
            await session.scalars(
                select(Dataset)
                .where(Dataset.id == dataset_id)
                .options(selectinload(Dataset.test_cases))
            )
        ).one_or_none()
        if dataset is None:
            raise DatasetNotFoundError("Dataset not found.")
    elif destination.get("mode") == "new":
        try:
            normalize_dataset_name(str(destination.get("name", "")))
            normalize_description(destination.get("description"))
        except DatasetValidationError as exc:
            raise ImportError(str(exc)) from exc
    else:
        raise ImportError(
            "Choose whether to create a dataset or add to an existing one."
        )
    encoded = canonical_csv and any(
        isinstance(row.values.get("text_encoding"), str)
        and row.values["text_encoding"].lstrip("'") == "apostrophe-v1"
        for row in rows
    )
    parsed: list[tuple[SourceRow, dict[str, Any] | None]] = []
    issues: list[dict[str, Any]] = []
    for source_row in rows:
        case, row_issues = _case(source_row, mapping, encoded)
        parsed.append((source_row, case))
        issues.extend(row_issues)
    existing = defaultdict(list)
    if dataset:
        for item in dataset.test_cases:
            existing[(item.input, item.case_type, item.security_test_type)].append(item)
    action = options.get("duplicate_action", "skip")
    valid_only = options.get("invalid_policy") == "valid_only"
    seen: dict[tuple[str, str, str | None], int] = {}
    preview_rows: list[dict[str, Any]] = []
    adds = replaces = skips = unchanged = 0
    for source_row, case in parsed:
        result = {
            "row_number": source_row.row_number,
            "status": "invalid" if case is None else "add",
            "action": None,
            "existing_ids": [],
        }
        if case is None:
            preview_rows.append(result)
            continue
        key = _key(case)
        result["case"] = {
            "input": case["input"],
            "expected_answer": case["expected_answer"],
            "case_type": case["case_type"],
            "security_test_type": case["security_test_type"],
            "category": case["category"],
            "metadata": case["metadata_json"],
        }
        matches = existing[key]
        result["existing_ids"] = [str(item.id) for item in matches]
        if key in seen:
            if action == "keep":
                adds += 1
            elif action == "replace":
                result.update(
                    status="skip",
                    action="skip",
                    reason="A later uploaded duplicate will replace this row.",
                )
                skips += 1
            else:
                result.update(
                    status="skip",
                    action="skip",
                    reason="Duplicate in upload; first valid row wins.",
                )
                skips += 1
        elif matches:
            if action == "keep":
                result.update(status="add", action="keep")
                adds += 1
            elif action == "replace" and len(matches) == 1:
                current = matches[0]
                fields_same = (
                    all(
                        getattr(current, field) == case[field]
                        for field in (
                            "input",
                            "expected_answer",
                            "case_type",
                            "security_test_type",
                            "category",
                        )
                    )
                    and current.metadata_json == case["metadata_json"]
                )
                if fields_same:
                    result.update(
                        status="unchanged", action="replace", target_id=str(current.id)
                    )
                    unchanged += 1
                else:
                    result.update(
                        status="replace", action="replace", target_id=str(current.id)
                    )
                    replaces += 1
            elif action == "replace":
                result.update(
                    status="conflict",
                    action="replace",
                    reason="Choose one replacement target; multiple existing cases match.",
                )
            else:
                result.update(
                    status="skip", action="skip", reason="Matches an existing case."
                )
                skips += 1
        else:
            result["action"] = "add"
            adds += 1
        seen[key] = source_row.row_number
        preview_rows.append(result)
    invalid_count = sum(1 for _, case in parsed if case is None)
    final_count = (len(dataset.test_cases) if dataset else 0) + adds
    conflicts = [item for item in preview_rows if item["status"] == "conflict"]
    can_commit = (
        not conflicts
        and (valid_only or invalid_count == 0)
        and adds + replaces + unchanged > 0
        and 1 <= final_count <= MAX_TEST_CASES_PER_DATASET
    )
    state = [
        {"id": str(item.id), "updated_at": item.updated_at.isoformat()}
        for item in (dataset.test_cases if dataset else [])
    ]
    resolved_options = {**options, "mapping": mapping}
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "file": hashlib.sha256(content).hexdigest(),
                "options": resolved_options,
                "state": state,
            },
            sort_keys=True,
            default=str,
        ).encode()
    ).hexdigest()
    return {
        "source_columns": headers,
        "suggestions": suggested_mapping(headers),
        "mapping": mapping,
        "rows": preview_rows,
        "issues": issues,
        "counts": {
            "add": adds,
            "replace": replaces,
            "unchanged": unchanged,
            "skip": skips,
            "invalid": invalid_count,
            "final": final_count,
        },
        "fingerprint": fingerprint,
        "can_commit": can_commit,
        "dataset_suggestion": envelope.get("dataset") if envelope else None,
        "message": None
        if can_commit
        else "Resolve validation errors, conflicts, or capacity before importing.",
    }


async def commit(
    session: AsyncSession,
    *,
    file_name: str,
    content: bytes,
    options: dict[str, Any],
    fingerprint: str,
    import_id: UUID,
) -> dict[str, Any]:
    request_digest = hashlib.sha256(
        content + json.dumps(options, sort_keys=True).encode()
    ).hexdigest()
    existing_receipt = await session.get(DatasetImportReceipt, import_id)
    if existing_receipt:
        if existing_receipt.request_digest != request_digest:
            raise DatasetConflictError(
                "This import ID was already used with different content."
            )
        return dict(existing_receipt.response_json)
    planned = await preview(
        session, file_name=file_name, content=content, options=options
    )
    if planned["fingerprint"] != fingerprint:
        raise DatasetConflictError("The destination changed. Preview the import again.")
    if not planned["can_commit"]:
        raise DatasetConflictError(
            "This import cannot be committed until its issues are resolved."
        )
    destination = options["destination"]
    await session.rollback()
    async with session.begin():
        if destination["mode"] == "new":
            name, name_key = normalize_dataset_name(destination["name"])
            dataset = Dataset(
                name=name,
                name_key=name_key,
                description=normalize_description(destination.get("description")),
            )
            session.add(dataset)
            await session.flush()
        else:
            dataset = await session.get(Dataset, UUID(destination["dataset_id"]))
            if dataset is None:
                raise DatasetNotFoundError("Dataset not found.")
        case_by_id = {
            str(item.id): item
            for item in (
                await session.scalars(
                    select(TestCase).where(TestCase.dataset_id == dataset.id)
                )
            ).all()
        }
        for row in planned["rows"]:
            case = row.get("case")
            if not case:
                continue
            values = dict(case)
            values["metadata_json"] = values.pop("metadata")
            if row["status"] == "add":
                session.add(TestCase(dataset_id=dataset.id, **values))
            elif row["status"] == "replace":
                target = case_by_id[row["target_id"]]
                for field, value in values.items():
                    setattr(target, field, value)
                target.updated_at = utc_now()
        dataset.updated_at = utc_now()
        response = {"dataset_id": str(dataset.id), "counts": planned["counts"]}
        session.add(
            DatasetImportReceipt(
                import_id=import_id,
                request_digest=request_digest,
                dataset_id=dataset.id,
                response_json=response,
            )
        )
    return response
