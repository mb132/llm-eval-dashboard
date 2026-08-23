"""Evaluation configuration and legacy local execution endpoints."""

from typing import Annotated, NoReturn, Self
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
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
from ..services.ollama import OllamaError, run_evaluation

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])
DatabaseSession = Annotated[AsyncSession, Depends(get_session)]
EvaluationModels = Annotated[list[ModelOption], Depends(get_evaluation_model_options)]
ModelId = Annotated[str, Field(min_length=1, max_length=100)]

TEST_QUESTION = "What is the capital of France?"
EVALUATION_PROMPT = (
    "Answer the following question accurately and concisely. "
    "Return only the answer, without additional explanation."
)


class EvaluationResponse(BaseModel):
    """Normalized result returned to the frontend."""

    model: str
    response: str
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None


class StrictRequest(BaseModel):
    """Reject request fields outside the evaluation configuration contract."""

    model_config = ConfigDict(extra="forbid")


class EvaluationConfigurationRequest(StrictRequest):
    """Selections that define a future evaluation run."""

    model_ids: list[ModelId] = Field(
        min_length=1,
        max_length=MAX_SELECTED_MODELS,
    )
    prompt_version_ids: list[UUID] = Field(
        min_length=1,
        max_length=MAX_SELECTED_PROMPT_VERSIONS,
    )
    dataset_id: UUID
    # Repetitions are provider-independent. Temperature and token overrides need
    # model capabilities from F01 before they can be offered safely.
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


def _options_response(options: EvaluationOptions) -> EvaluationOptionsResponse:
    return EvaluationOptionsResponse(
        models=[
            ModelOptionResponse(
                id=model.id,
                provider=model.provider,
                name=model.name,
            )
            for model in options.models
        ],
        prompt_versions=[
            PromptVersionOptionResponse(
                id=version.id,
                prompt_id=version.prompt_id,
                prompt_name=version.prompt_name,
                version_number=version.version_number,
                content_preview=version.content_preview,
            )
            for version in options.prompt_versions
        ],
        datasets=[
            DatasetOptionResponse(
                id=dataset.id,
                name=dataset.name,
                test_case_count=dataset.test_case_count,
            )
            for dataset in options.datasets
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


def _raise_configuration_error(exc: Exception) -> NoReturn:
    if isinstance(exc, EvaluationDatasetNotFoundError):
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
    options = await get_evaluation_options(session, models=models)
    return _options_response(options)


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
        _raise_configuration_error(exc)
    return _preview_response(preview)


@router.post("/run", response_model=EvaluationResponse)
async def run_hardcoded_evaluation() -> EvaluationResponse:
    """Run the single hardcoded prompt and question against local Ollama."""
    try:
        result = await run_evaluation(EVALUATION_PROMPT, TEST_QUESTION)
    except OllamaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return EvaluationResponse(
        model=result.model,
        response=result.response,
        latency_ms=result.latency_ms,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )
