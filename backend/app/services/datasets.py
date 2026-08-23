"""Dataset-management validation and persistence operations."""

import json
import math
import unicodedata
from collections.abc import Mapping
from typing import Any, cast
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.functions import count as sql_count

from ..models import Dataset, TestCase
from ..models.base import utc_now

type MetadataValue = str | int | float | bool | None

MAX_NAME_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 500
MAX_INPUT_LENGTH = 20_000
MAX_EXPECTED_ANSWER_LENGTH = 20_000
MAX_CATEGORY_LENGTH = 100
MAX_TEST_CASES_PER_DATASET = 500
MAX_METADATA_ENTRIES = 20
MAX_METADATA_KEY_LENGTH = 100
MAX_METADATA_STRING_LENGTH = 1_000
MAX_METADATA_JSON_LENGTH = 10_000


class DatasetNotFoundError(LookupError):
    """Raised when a requested dataset does not exist."""


class TestCaseNotFoundError(LookupError):
    """Raised when a requested test case does not belong to the dataset."""


class DatasetConflictError(RuntimeError):
    """Raised when a dataset operation conflicts with a persistent invariant."""


class DatasetValidationError(ValueError):
    """Raised when normalized dataset data violates a domain rule."""


def normalize_dataset_name(value: str) -> tuple[str, str]:
    """Return a clean dataset display name and case-insensitive key."""
    display_name = " ".join(unicodedata.normalize("NFKC", value).split())
    if not display_name:
        raise DatasetValidationError("Dataset name must not be empty.")
    if len(display_name) > MAX_NAME_LENGTH:
        raise DatasetValidationError(
            f"Dataset name must contain at most {MAX_NAME_LENGTH} characters."
        )
    name_key = display_name.casefold()
    if len(name_key) > MAX_NAME_LENGTH:
        raise DatasetValidationError(
            "Dataset name is too long after Unicode normalization."
        )
    return display_name, name_key


def normalize_description(value: str | None) -> str | None:
    """Trim an optional description and represent empty text as null."""
    if value is None:
        return None
    description = value.strip()
    if not description:
        return None
    if len(description) > MAX_DESCRIPTION_LENGTH:
        raise DatasetValidationError(
            f"Description must contain at most {MAX_DESCRIPTION_LENGTH} characters."
        )
    return description


def validate_required_text(value: str, *, label: str, maximum: int) -> str:
    """Validate required untrusted text without altering its meaningful spacing."""
    if not value.strip():
        raise DatasetValidationError(f"{label} must not be empty.")
    if len(value) > maximum:
        raise DatasetValidationError(
            f"{label} must contain at most {maximum} characters."
        )
    return value


def normalize_category(value: str | None) -> str | None:
    """Normalize optional category whitespace."""
    if value is None:
        return None
    category = " ".join(value.split())
    if not category:
        return None
    if len(category) > MAX_CATEGORY_LENGTH:
        raise DatasetValidationError(
            f"Category must contain at most {MAX_CATEGORY_LENGTH} characters."
        )
    return category


def validate_metadata(
    value: Mapping[str, MetadataValue] | None,
) -> dict[str, MetadataValue] | None:
    """Validate a small, flat JSON-compatible metadata object."""
    if value is None or not value:
        return None
    if len(value) > MAX_METADATA_ENTRIES:
        raise DatasetValidationError(
            f"Metadata must contain at most {MAX_METADATA_ENTRIES} entries."
        )

    validated: dict[str, MetadataValue] = {}
    for key, item in value.items():
        clean_key = key.strip()
        if not clean_key:
            raise DatasetValidationError("Metadata keys must not be empty.")
        if len(clean_key) > MAX_METADATA_KEY_LENGTH:
            raise DatasetValidationError(
                "Metadata keys must contain at most "
                f"{MAX_METADATA_KEY_LENGTH} characters."
            )
        if clean_key in validated:
            raise DatasetValidationError("Metadata keys must be unique after trimming.")
        if isinstance(item, str) and len(item) > MAX_METADATA_STRING_LENGTH:
            raise DatasetValidationError(
                "Metadata text values must contain at most "
                f"{MAX_METADATA_STRING_LENGTH} characters."
            )
        if isinstance(item, float) and not math.isfinite(item):
            raise DatasetValidationError("Metadata numbers must be finite.")
        validated[clean_key] = item

    serialized = json.dumps(validated, ensure_ascii=False, separators=(",", ":"))
    if len(serialized) > MAX_METADATA_JSON_LENGTH:
        raise DatasetValidationError(
            f"Metadata must serialize to at most {MAX_METADATA_JSON_LENGTH} characters."
        )
    return validated


def validate_test_case_fields(values: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize provided test-case fields for create or partial update."""
    normalized: dict[str, Any] = {}
    if "input" in values:
        normalized["input"] = validate_required_text(
            values["input"], label="Input", maximum=MAX_INPUT_LENGTH
        )
    if "expected_answer" in values:
        normalized["expected_answer"] = validate_required_text(
            values["expected_answer"],
            label="Expected answer",
            maximum=MAX_EXPECTED_ANSWER_LENGTH,
        )
    if "category" in values:
        normalized["category"] = normalize_category(values["category"])
    if "metadata" in values:
        normalized["metadata_json"] = validate_metadata(values["metadata"])
    return normalized


async def create_dataset(
    session: AsyncSession,
    *,
    name: str,
    description: str | None,
    test_case: Mapping[str, Any],
) -> Dataset:
    """Create a dataset and its required first test case atomically."""
    display_name, name_key = normalize_dataset_name(name)
    normalized_case = validate_test_case_fields(test_case)
    dataset = Dataset(
        name=display_name,
        name_key=name_key,
        description=normalize_description(description),
        test_cases=[TestCase(**normalized_case)],
    )
    try:
        async with session.begin():
            session.add(dataset)
    except IntegrityError as exc:
        raise DatasetConflictError("A dataset with this name already exists.") from exc
    return dataset


async def list_datasets(session: AsyncSession) -> list[tuple[Dataset, int]]:
    """List datasets with test-case counts, newest activity first."""
    statement = (
        select(Dataset, sql_count(TestCase.id).label("test_case_count"))
        .outerjoin(TestCase, TestCase.dataset_id == Dataset.id)
        .group_by(Dataset.id)
        .order_by(Dataset.updated_at.desc(), Dataset.name.asc())
    )
    rows = (await session.execute(statement)).all()
    return [(dataset, count) for dataset, count in rows]


async def get_dataset(session: AsyncSession, dataset_id: UUID) -> Dataset:
    """Return a dataset with all test cases loaded in stable order."""
    statement = (
        select(Dataset)
        .where(Dataset.id == dataset_id)
        .options(selectinload(Dataset.test_cases))
    )
    dataset = (await session.scalars(statement)).one_or_none()
    if dataset is None:
        raise DatasetNotFoundError("Dataset not found.")
    dataset.test_cases.sort(key=lambda item: (item.created_at, str(item.id)))
    return dataset


async def update_dataset(
    session: AsyncSession,
    dataset_id: UUID,
    updates: Mapping[str, Any],
) -> Dataset:
    """Update editable dataset metadata."""
    try:
        async with session.begin():
            dataset = await session.get(Dataset, dataset_id)
            if dataset is None:
                raise DatasetNotFoundError("Dataset not found.")
            if "name" in updates:
                dataset.name, dataset.name_key = normalize_dataset_name(updates["name"])
            if "description" in updates:
                dataset.description = normalize_description(updates["description"])
            dataset.updated_at = utc_now()
    except IntegrityError as exc:
        raise DatasetConflictError("A dataset with this name already exists.") from exc
    return await get_dataset(session, dataset_id)


async def create_test_case(
    session: AsyncSession,
    dataset_id: UUID,
    *,
    values: Mapping[str, Any],
) -> TestCase:
    """Append a validated test case while enforcing the dataset size bound."""
    normalized = validate_test_case_fields(values)
    async with session.begin():
        dataset = await session.get(Dataset, dataset_id)
        if dataset is None:
            raise DatasetNotFoundError("Dataset not found.")
        test_case_count = await session.scalar(
            select(sql_count(TestCase.id)).where(TestCase.dataset_id == dataset_id)
        )
        if (test_case_count or 0) >= MAX_TEST_CASES_PER_DATASET:
            raise DatasetConflictError(
                "A dataset may contain at most "
                f"{MAX_TEST_CASES_PER_DATASET} test cases."
            )
        test_case = TestCase(dataset_id=dataset_id, **normalized)
        session.add(test_case)
        dataset.updated_at = utc_now()
    return test_case


async def update_test_case(
    session: AsyncSession,
    dataset_id: UUID,
    test_case_id: UUID,
    updates: Mapping[str, Any],
) -> TestCase:
    """Update a test case that belongs to the requested dataset."""
    normalized = validate_test_case_fields(updates)
    async with session.begin():
        dataset = await session.get(Dataset, dataset_id)
        if dataset is None:
            raise DatasetNotFoundError("Dataset not found.")
        statement = select(TestCase).where(
            TestCase.id == test_case_id,
            TestCase.dataset_id == dataset_id,
        )
        test_case = (await session.scalars(statement)).one_or_none()
        if test_case is None:
            raise TestCaseNotFoundError("Test case not found.")
        for field, value in normalized.items():
            setattr(test_case, field, value)
        test_case.updated_at = utc_now()
        dataset.updated_at = test_case.updated_at
    return test_case


async def delete_test_case(
    session: AsyncSession,
    dataset_id: UUID,
    test_case_id: UUID,
) -> None:
    """Delete a test case unless it is the dataset's last member."""
    async with session.begin():
        dataset = await session.get(Dataset, dataset_id)
        if dataset is None:
            raise DatasetNotFoundError("Dataset not found.")
        statement = select(TestCase.id).where(
            TestCase.id == test_case_id,
            TestCase.dataset_id == dataset_id,
        )
        if (await session.scalar(statement)) is None:
            raise TestCaseNotFoundError("Test case not found.")
        remaining_members = (
            select(sql_count(TestCase.id))
            .where(TestCase.dataset_id == dataset_id)
            .scalar_subquery()
        )
        delete_statement = delete(TestCase).where(
            TestCase.id == test_case_id,
            TestCase.dataset_id == dataset_id,
            remaining_members > 1,
        )
        result = cast(CursorResult[Any], await session.execute(delete_statement))
        if result.rowcount != 1:
            raise DatasetConflictError("A dataset must contain at least one test case.")
        dataset.updated_at = utc_now()
