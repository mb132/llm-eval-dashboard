"""Evaluation configuration, execution, progress, and result endpoints."""

from datetime import datetime
from typing import Annotated, NoReturn, Self
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..database import get_session, get_session_factory
from ..models import EvaluationResult, EvaluationRun
from ..services.evaluation_configuration import (
    MAX_REPETITIONS,
    MAX_SELECTED_MODELS,
    MAX_SELECTED_PROMPT_VERSIONS,
    EvaluationConfigurationError,
    EvaluationDatasetNotFoundError,
    EvaluationOptions,
    EvaluationPreview,
    ModelOption,
    get_evaluation_model_options,
    get_evaluation_options,
    preview_evaluation_configuration,
)
from ..services.evaluation_execution import (
    DEFAULT_RESULT_PAGE_SIZE,
    DEFAULT_RUN_PAGE_SIZE,
    MAX_RESULT_PAGE_SIZE,
    MAX_RUN_PAGE_SIZE,
    EvaluationRunNotFoundError,
    EvaluationRunPage,
    ResultPage,
    create_evaluation_run,
    execute_evaluation_run,
    get_evaluation_run,
    list_evaluation_results,
    list_evaluation_runs,
)

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])
DatabaseSession = Annotated[AsyncSession, Depends(get_session)]
EvaluationSessionFactory = Annotated[
    async_sessionmaker[AsyncSession], Depends(get_session_factory)
]
ModelId = Annotated[str, Field(min_length=1, max_length=100)]


async def get_evaluation_models(session: DatabaseSession) -> list[ModelOption]:
    """Resolve selectable models from persisted configuration records."""
    return await get_evaluation_model_options(session)


EvaluationModels = Annotated[list[ModelOption], Depends(get_evaluation_models)]


class StrictRequest(BaseModel):
    """Reject request fields outside the evaluation configuration contract."""

    model_config = ConfigDict(extra="forbid")


class EvaluationConfigurationRequest(StrictRequest):
    """Selections that define an evaluation run."""

    model_ids: list[ModelId] = Field(
        min_length=1,
        max_length=MAX_SELECTED_MODELS,
    )
    prompt_version_ids: list[UUID] = Field(
        min_length=1,
        max_length=MAX_SELECTED_PROMPT_VERSIONS,
    )
    dataset_id: UUID
    # Provider-independent today. Model-specific controls require F01 capability
    # metadata before they can be exposed safely.
    repetitions: int = Field(default=1, ge=1, le=MAX_REPETITIONS)

    @model_validator(mode="after")
    def require_unique_selections(self) -> Self:
        """Reject duplicates rather than silently changing request cardinality."""
        if len(self.model_ids) != len(set(self.model_ids)):
            raise ValueError("Selected models must be unique.")
        if len(self.prompt_version_ids) != len(set(self.prompt_version_ids)):
            raise ValueError("Selected prompt versions must be unique.")
        return self


class ModelOptionResponse(BaseModel):
    """Provider-neutral model option exposed to the frontend."""

    id: str
    provider: str
    name: str
    model_name: str


class PromptVersionOptionResponse(BaseModel):
    """Prompt version shown in the evaluation configuration interface."""

    id: UUID
    prompt_id: UUID
    prompt_name: str
    version_number: int
    content_preview: str


class DatasetOptionResponse(BaseModel):
    """Dataset summary shown in the evaluation configuration interface."""

    id: UUID
    name: str
    test_case_count: int


class EvaluationOptionsResponse(BaseModel):
    """All currently selectable inputs for an evaluation."""

    models: list[ModelOptionResponse]
    prompt_versions: list[PromptVersionOptionResponse]
    datasets: list[DatasetOptionResponse]


class EvaluationPreviewResponse(BaseModel):
    """Validated cardinality of a future evaluation run."""

    model_ids: list[str]
    prompt_version_ids: list[UUID]
    dataset_id: UUID
    repetitions: int
    model_count: int
    prompt_version_count: int
    test_case_count: int
    combination_count: int
    total_requests: int


class EvaluationRunResponse(BaseModel):
    """Persistent run status and progress counters."""

    id: UUID
    status: str
    dataset_id: UUID
    dataset_name: str
    repetitions: int
    total_requests: int
    completed_requests: int
    successful_requests: int
    failed_requests: int
    failure_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class EvaluationResultResponse(BaseModel):
    """One stored request snapshot and its current outcome."""

    id: UUID
    sequence_number: int
    status: str
    model_id: str
    model_provider: str
    model_name: str
    reported_model_name: str | None
    prompt_id: UUID
    prompt_version_id: UUID
    prompt_name: str
    prompt_version_number: int
    test_case_id: UUID
    repetition: int
    max_output_tokens: int
    rendered_prompt: str
    test_input: str
    expected_output: str
    generated_output: str | None
    error_code: str | None
    error_message: str | None
    latency_ms: int | None
    input_tokens: int | None
    output_tokens: int | None
    started_at: datetime | None
    completed_at: datetime | None


class EvaluationResultPageResponse(BaseModel):
    """Bounded result page for progress polling and later inspection."""

    items: list[EvaluationResultResponse]
    total: int
    offset: int
    limit: int


class EvaluationRunPageResponse(BaseModel):
    """Bounded archive page with all-time run health totals."""

    items: list[EvaluationRunResponse]
    total: int
    completed: int
    failed: int
    offset: int
    limit: int


def _options_response(options: EvaluationOptions) -> EvaluationOptionsResponse:
    return EvaluationOptionsResponse(
        models=[
            ModelOptionResponse(
                id=item.id,
                provider=item.provider,
                name=item.name,
                model_name=item.model_name,
            )
            for item in options.models
        ],
        prompt_versions=[
            PromptVersionOptionResponse(
                id=item.id,
                prompt_id=item.prompt_id,
                prompt_name=item.prompt_name,
                version_number=item.version_number,
                content_preview=item.content_preview,
            )
            for item in options.prompt_versions
        ],
        datasets=[
            DatasetOptionResponse(
                id=item.id,
                name=item.name,
                test_case_count=item.test_case_count,
            )
            for item in options.datasets
        ],
    )


def _preview_response(preview: EvaluationPreview) -> EvaluationPreviewResponse:
    return EvaluationPreviewResponse(
        model_ids=preview.model_ids,
        prompt_version_ids=preview.prompt_version_ids,
        dataset_id=preview.dataset_id,
        repetitions=preview.repetitions,
        model_count=preview.model_count,
        prompt_version_count=preview.prompt_version_count,
        test_case_count=preview.test_case_count,
        combination_count=preview.combination_count,
        total_requests=preview.total_requests,
    )


def _run_response(evaluation: EvaluationRun) -> EvaluationRunResponse:
    return EvaluationRunResponse(
        id=evaluation.id,
        status=evaluation.status,
        dataset_id=evaluation.dataset_id,
        dataset_name=evaluation.dataset_name,
        repetitions=evaluation.repetitions,
        total_requests=evaluation.total_requests,
        completed_requests=evaluation.completed_requests,
        successful_requests=evaluation.successful_requests,
        failed_requests=evaluation.failed_requests,
        failure_message=evaluation.failure_message,
        created_at=evaluation.created_at,
        started_at=evaluation.started_at,
        completed_at=evaluation.completed_at,
    )


def _result_response(result: EvaluationResult) -> EvaluationResultResponse:
    return EvaluationResultResponse(
        id=result.id,
        sequence_number=result.sequence_number,
        status=result.status,
        model_id=result.model_id,
        model_provider=result.model_provider,
        model_name=result.model_name,
        reported_model_name=result.reported_model_name,
        prompt_id=result.prompt_id,
        prompt_version_id=result.prompt_version_id,
        prompt_name=result.prompt_name,
        prompt_version_number=result.prompt_version_number,
        test_case_id=result.test_case_id,
        repetition=result.repetition,
        max_output_tokens=result.max_output_tokens,
        rendered_prompt=result.rendered_prompt,
        test_input=result.test_input,
        expected_output=result.expected_output,
        generated_output=result.generated_output,
        error_code=result.error_code,
        error_message=result.error_message,
        latency_ms=result.latency_ms,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        started_at=result.started_at,
        completed_at=result.completed_at,
    )


def _result_page_response(page: ResultPage) -> EvaluationResultPageResponse:
    return EvaluationResultPageResponse(
        items=[_result_response(item) for item in page.items],
        total=page.total,
        offset=page.offset,
        limit=page.limit,
    )


def _run_page_response(page: EvaluationRunPage) -> EvaluationRunPageResponse:
    return EvaluationRunPageResponse(
        items=[_run_response(item) for item in page.items],
        total=page.total,
        completed=page.completed,
        failed=page.failed,
        offset=page.offset,
        limit=page.limit,
    )


def _raise_evaluation_error(exc: Exception) -> NoReturn:
    if isinstance(exc, (EvaluationDatasetNotFoundError, EvaluationRunNotFoundError)):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, EvaluationConfigurationError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    raise exc


@router.get("/options", response_model=EvaluationOptionsResponse)
async def read_evaluation_options(
    session: DatabaseSession,
    models: EvaluationModels,
) -> EvaluationOptionsResponse:
    """Return normalized models, prompt versions, and datasets."""
    return _options_response(await get_evaluation_options(session, models=models))


@router.post("/preview", response_model=EvaluationPreviewResponse)
async def preview_evaluation(
    payload: EvaluationConfigurationRequest,
    session: DatabaseSession,
    models: EvaluationModels,
) -> EvaluationPreviewResponse:
    """Validate a configuration and calculate its future request count."""
    try:
        preview = await preview_evaluation_configuration(
            session,
            models=models,
            **payload.model_dump(),
        )
    except (EvaluationConfigurationError, EvaluationDatasetNotFoundError) as exc:
        _raise_evaluation_error(exc)
    return _preview_response(preview)


@router.post(
    "",
    response_model=EvaluationRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_evaluation(
    payload: EvaluationConfigurationRequest,
    background_tasks: BackgroundTasks,
    session: DatabaseSession,
    session_factory: EvaluationSessionFactory,
    models: EvaluationModels,
) -> EvaluationRunResponse:
    """Persist a validated run and schedule its bounded background execution."""
    try:
        evaluation = await create_evaluation_run(
            session,
            models=models,
            **payload.model_dump(),
        )
    except (EvaluationConfigurationError, EvaluationDatasetNotFoundError) as exc:
        _raise_evaluation_error(exc)
    background_tasks.add_task(
        execute_evaluation_run,
        evaluation.id,
        session_factory=session_factory,
    )
    return _run_response(evaluation)


@router.get("", response_model=EvaluationRunPageResponse)
async def read_evaluation_runs(
    session: DatabaseSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=MAX_RUN_PAGE_SIZE)] = DEFAULT_RUN_PAGE_SIZE,
) -> EvaluationRunPageResponse:
    """Return the persisted evaluation archive, newest run first."""
    return _run_page_response(
        await list_evaluation_runs(session, offset=offset, limit=limit)
    )


@router.get("/{evaluation_id}", response_model=EvaluationRunResponse)
async def read_evaluation_run(
    evaluation_id: UUID,
    session: DatabaseSession,
) -> EvaluationRunResponse:
    """Return current progress for one persisted evaluation."""
    try:
        evaluation = await get_evaluation_run(session, evaluation_id)
    except EvaluationRunNotFoundError as exc:
        _raise_evaluation_error(exc)
    return _run_response(evaluation)


@router.get(
    "/{evaluation_id}/results",
    response_model=EvaluationResultPageResponse,
)
async def read_evaluation_results(
    evaluation_id: UUID,
    session: DatabaseSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[
        int,
        Query(ge=1, le=MAX_RESULT_PAGE_SIZE),
    ] = DEFAULT_RESULT_PAGE_SIZE,
) -> EvaluationResultPageResponse:
    """Return one bounded page of stored result snapshots."""
    try:
        page = await list_evaluation_results(
            session,
            evaluation_id,
            offset=offset,
            limit=limit,
        )
    except EvaluationRunNotFoundError as exc:
        _raise_evaluation_error(exc)
    return _result_page_response(page)
