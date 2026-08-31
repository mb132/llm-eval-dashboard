"""REST API for dataset and test-case management."""

from datetime import datetime
from typing import Annotated, Literal, NoReturn, Self, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..models import Dataset, TestCase
from ..services.datasets import (
    MAX_CATEGORY_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_EXPECTED_ANSWER_LENGTH,
    MAX_INPUT_LENGTH,
    MAX_METADATA_ENTRIES,
    MAX_METADATA_KEY_LENGTH,
    MAX_NAME_LENGTH,
    DatasetConflictError,
    DatasetNotFoundError,
    DatasetValidationError,
    MetadataValue,
    TestCaseNotFoundError,
    create_dataset,
    create_test_case,
    delete_test_case,
    get_dataset,
    list_datasets,
    update_dataset,
    update_test_case,
)

router = APIRouter(prefix="/api/datasets", tags=["datasets"])
DatabaseSession = Annotated[AsyncSession, Depends(get_session)]
CaseType = Literal["standard", "security"]
SecurityTestType = Literal[
    "direct_prompt_injection",
    "instruction_override",
    "system_prompt_extraction",
]


class StrictRequest(BaseModel):
    """Reject fields outside the public dataset contract."""

    model_config = ConfigDict(extra="forbid")


Metadata = Annotated[
    dict[
        Annotated[str, Field(min_length=1, max_length=MAX_METADATA_KEY_LENGTH)],
        Annotated[
            MetadataValue,
            Field(),
        ],
    ],
    Field(max_length=MAX_METADATA_ENTRIES),
]


class TestCaseCreate(StrictRequest):
    """Payload for a new test case."""

    input: str = Field(min_length=1, max_length=MAX_INPUT_LENGTH)
    expected_answer: str = Field(min_length=1, max_length=MAX_EXPECTED_ANSWER_LENGTH)
    case_type: CaseType = "standard"
    security_test_type: SecurityTestType | None = None
    category: str | None = Field(default=None, max_length=MAX_CATEGORY_LENGTH)
    metadata: Metadata | None = None


class TestCaseUpdate(StrictRequest):
    """Partial payload for editing a test case."""

    input: str | None = Field(default=None, min_length=1, max_length=MAX_INPUT_LENGTH)
    expected_answer: str | None = Field(
        default=None, min_length=1, max_length=MAX_EXPECTED_ANSWER_LENGTH
    )
    case_type: CaseType | None = None
    security_test_type: SecurityTestType | None = None
    category: str | None = Field(default=None, max_length=MAX_CATEGORY_LENGTH)
    metadata: Metadata | None = None

    @model_validator(mode="after")
    def require_update(self) -> Self:
        """Require at least one field and preserve required-field nullability."""
        if not self.model_fields_set:
            raise ValueError("At least one test case field must be provided.")
        for field in ("input", "expected_answer", "case_type"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field.replace('_', ' ').title()} must not be null.")
        return self


class DatasetCreate(StrictRequest):
    """Payload for a dataset and its required first test case."""

    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    test_case: TestCaseCreate


class DatasetUpdate(StrictRequest):
    """Editable dataset metadata."""

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)

    @model_validator(mode="after")
    def require_update(self) -> Self:
        """Require at least one field and preserve the non-null dataset name."""
        if not self.model_fields_set:
            raise ValueError("At least one dataset field must be provided.")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Dataset name must not be null.")
        return self


class TestCaseResponse(BaseModel):
    """Public representation of a reusable test case."""

    id: UUID
    dataset_id: UUID
    input: str
    expected_answer: str
    case_type: CaseType
    security_test_type: SecurityTestType | None
    category: str | None
    metadata: dict[str, MetadataValue] | None
    created_at: datetime
    updated_at: datetime


class DatasetSummaryResponse(BaseModel):
    """Compact dataset representation for lists and future selectors."""

    id: UUID
    name: str
    description: str | None
    test_case_count: int
    created_at: datetime
    updated_at: datetime


class DatasetDetailResponse(BaseModel):
    """Dataset metadata and its complete test-case collection."""

    id: UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    test_cases: list[TestCaseResponse]


def _test_case_response(test_case: TestCase) -> TestCaseResponse:
    return TestCaseResponse(
        id=test_case.id,
        dataset_id=test_case.dataset_id,
        input=test_case.input,
        expected_answer=test_case.expected_answer,
        case_type=cast(CaseType, test_case.case_type),
        security_test_type=cast(SecurityTestType | None, test_case.security_test_type),
        category=test_case.category,
        metadata=test_case.metadata_json,
        created_at=test_case.created_at,
        updated_at=test_case.updated_at,
    )


def _detail_response(dataset: Dataset) -> DatasetDetailResponse:
    return DatasetDetailResponse(
        id=dataset.id,
        name=dataset.name,
        description=dataset.description,
        created_at=dataset.created_at,
        updated_at=dataset.updated_at,
        test_cases=[_test_case_response(item) for item in dataset.test_cases],
    )


def _raise_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, (DatasetNotFoundError, TestCaseNotFoundError)):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, DatasetConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, DatasetValidationError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    raise exc


@router.get("", response_model=list[DatasetSummaryResponse])
async def read_datasets(session: DatabaseSession) -> list[DatasetSummaryResponse]:
    """List all datasets ordered by most recent activity."""
    datasets = await list_datasets(session)
    return [
        DatasetSummaryResponse(
            id=dataset.id,
            name=dataset.name,
            description=dataset.description,
            test_case_count=count,
            created_at=dataset.created_at,
            updated_at=dataset.updated_at,
        )
        for dataset, count in datasets
    ]


@router.post(
    "", response_model=DatasetDetailResponse, status_code=status.HTTP_201_CREATED
)
async def add_dataset(
    payload: DatasetCreate, session: DatabaseSession
) -> DatasetDetailResponse:
    """Create a dataset with its first test case."""
    try:
        dataset = await create_dataset(
            session,
            name=payload.name,
            description=payload.description,
            test_case=payload.test_case.model_dump(),
        )
    except (DatasetConflictError, DatasetValidationError) as exc:
        _raise_http_error(exc)
    return _detail_response(dataset)


@router.get("/{dataset_id}", response_model=DatasetDetailResponse)
async def read_dataset(
    dataset_id: UUID, session: DatabaseSession
) -> DatasetDetailResponse:
    """Return one dataset and all its test cases."""
    try:
        dataset = await get_dataset(session, dataset_id)
    except DatasetNotFoundError as exc:
        _raise_http_error(exc)
    return _detail_response(dataset)


@router.patch("/{dataset_id}", response_model=DatasetDetailResponse)
async def edit_dataset(
    dataset_id: UUID,
    payload: DatasetUpdate,
    session: DatabaseSession,
) -> DatasetDetailResponse:
    """Update a dataset's editable metadata."""
    try:
        dataset = await update_dataset(
            session, dataset_id, payload.model_dump(exclude_unset=True)
        )
    except (DatasetConflictError, DatasetNotFoundError, DatasetValidationError) as exc:
        _raise_http_error(exc)
    return _detail_response(dataset)


@router.post(
    "/{dataset_id}/test-cases",
    response_model=TestCaseResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_test_case(
    dataset_id: UUID,
    payload: TestCaseCreate,
    session: DatabaseSession,
) -> TestCaseResponse:
    """Append one test case to a dataset."""
    try:
        test_case = await create_test_case(
            session, dataset_id, values=payload.model_dump()
        )
    except (DatasetConflictError, DatasetNotFoundError, DatasetValidationError) as exc:
        _raise_http_error(exc)
    return _test_case_response(test_case)


@router.patch(
    "/{dataset_id}/test-cases/{test_case_id}",
    response_model=TestCaseResponse,
)
async def edit_test_case(
    dataset_id: UUID,
    test_case_id: UUID,
    payload: TestCaseUpdate,
    session: DatabaseSession,
) -> TestCaseResponse:
    """Update one test case belonging to a dataset."""
    try:
        test_case = await update_test_case(
            session,
            dataset_id,
            test_case_id,
            payload.model_dump(exclude_unset=True),
        )
    except (
        DatasetNotFoundError,
        DatasetValidationError,
        TestCaseNotFoundError,
    ) as exc:
        _raise_http_error(exc)
    return _test_case_response(test_case)


@router.delete(
    "/{dataset_id}/test-cases/{test_case_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_test_case(
    dataset_id: UUID,
    test_case_id: UUID,
    session: DatabaseSession,
) -> Response:
    """Delete one test case while preserving the non-empty invariant."""
    try:
        await delete_test_case(session, dataset_id, test_case_id)
    except (DatasetConflictError, DatasetNotFoundError, TestCaseNotFoundError) as exc:
        _raise_http_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
