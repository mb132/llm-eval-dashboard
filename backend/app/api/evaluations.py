"""Evaluation configuration, execution, progress, and result endpoints."""

from datetime import date, datetime
from typing import Annotated, Literal, NoReturn, Self
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..database import get_session, get_session_factory
from ..models import EvaluationResult, EvaluationRun
from ..services.costs import (
    CostAggregate,
    CostEvaluationNotFoundError,
    CostSummary,
    ModelCostAggregate,
    PromptCostAggregate,
    get_cost_summary,
)
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
    EvaluationRunArchiveItem,
    EvaluationRunNotFoundError,
    EvaluationRunPage,
    ResultFilters,
    ResultPage,
    create_evaluation_run,
    execute_evaluation_run,
    get_evaluation_run,
    list_evaluation_results,
    list_evaluation_runs,
)
from ..services.performance import (
    LatencyAggregate,
    ModelLatencyAggregate,
    ModelTokenAggregate,
    PerformanceEvaluationNotFoundError,
    PerformanceSummary,
    PromptLatencyAggregate,
    PromptTokenAggregate,
    TokenAggregate,
    get_performance_summary,
)
from ..services.pricing import micro_to_usd_string, nano_to_usd_string
from ..services.quality import (
    QUALITY_METRICS,
    ModelQualityAggregate,
    PromptQualityAggregate,
    QualityAggregate,
    QualityEvaluationNotFoundError,
    QualityMetricSummary,
    get_quality_summary,
)
from ..services.security import (
    SecurityAggregate,
    SecurityEvaluationNotFoundError,
    SecuritySummary,
    get_security_summary,
)

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])
QUALITY_METRIC_ORDER = {
    (metric.method, metric.version): index
    for index, metric in enumerate(QUALITY_METRICS)
}
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


class EvaluationRunModelResponse(BaseModel):
    id: str
    name: str


class EvaluationRunPromptVersionResponse(BaseModel):
    id: UUID
    name: str
    version_number: int


class EvaluationRunHistoryResponse(EvaluationRunResponse):
    """Archived run with immutable model and prompt identities."""

    models: list[EvaluationRunModelResponse]
    prompt_versions: list[EvaluationRunPromptVersionResponse]


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
    test_category: str | None
    case_type: str
    security_test_type: str | None
    security_metric_version: int | None
    security_status: str | None
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
    total_tokens: int | None
    pricing: "PricingSnapshotResponse | None"
    estimated_cost_usd: str | None
    quality_scores: list["QualityScoreResponse"]
    started_at: datetime | None
    completed_at: datetime | None


class EvaluationResultPageResponse(BaseModel):
    """Bounded result page for progress polling and later inspection."""

    items: list[EvaluationResultResponse]
    total: int
    unfiltered_total: int
    offset: int
    limit: int
    filter_options: "ResultFilterOptionsResponse"


class ResultFilterModelResponse(BaseModel):
    id: str
    name: str


class ResultFilterPromptVersionResponse(BaseModel):
    id: UUID
    name: str
    version_number: int


class ResultFilterOptionsResponse(BaseModel):
    models: list[ResultFilterModelResponse]
    prompt_versions: list[ResultFilterPromptVersionResponse]
    categories: list[str]
    has_uncategorized_category: bool


class EvaluationRunPageResponse(BaseModel):
    """Bounded archive page with all-time run health totals."""

    items: list[EvaluationRunHistoryResponse]
    total: int
    completed: int
    failed: int
    offset: int
    limit: int


class PricingSnapshotResponse(BaseModel):
    """Immutable pricing basis used for one request estimate."""

    input_usd_per_million_tokens: str
    output_usd_per_million_tokens: str
    currency: str
    source: str
    effective_date: date
    source_url: str | None


class QualityScoreResponse(BaseModel):
    """One versioned score, or null when the request could not be scored."""

    method: str
    version: int
    score: float | None


class QualityAggregateResponse(BaseModel):
    """One average with explicit scored and unavailable sample counts."""

    average_score: float | None
    scored_results: int
    unavailable_results: int


class ModelQualityAggregateResponse(QualityAggregateResponse):
    """Quality values grouped by model."""

    model_id: str
    model_name: str


class PromptQualityAggregateResponse(QualityAggregateResponse):
    """Quality values grouped by immutable prompt version."""

    prompt_version_id: UUID
    prompt_name: str
    prompt_version_number: int


class QualityMetricSummaryResponse(BaseModel):
    """Overall and grouped aggregations for one metric version."""

    method: str
    version: int
    overall: QualityAggregateResponse
    by_model: list[ModelQualityAggregateResponse]
    by_prompt_version: list[PromptQualityAggregateResponse]


class EvaluationQualitySummaryResponse(BaseModel):
    """All deterministic quality metrics for an evaluation."""

    metrics: list[QualityMetricSummaryResponse]


class SecurityAggregateResponse(BaseModel):
    """Security score with every denominator component exposed."""

    score: float | None
    total_tests: int
    passed_tests: int
    failed_tests: int
    unavailable_tests: int


class ModelSecurityAggregateResponse(SecurityAggregateResponse):
    model_id: str
    model_name: str


class PromptSecurityAggregateResponse(SecurityAggregateResponse):
    prompt_version_id: UUID
    prompt_name: str
    prompt_version_number: int


class EvaluationSecuritySummaryResponse(BaseModel):
    """Versioned security outcomes overall and by model and prompt."""

    metric_version: int
    overall: SecurityAggregateResponse
    by_model: list[ModelSecurityAggregateResponse]
    by_prompt_version: list[PromptSecurityAggregateResponse]


class LatencyAggregateResponse(BaseModel):
    """Full-response latency with explicit sample counts."""

    average_ms: float | None
    minimum_ms: int | None
    maximum_ms: int | None
    recorded_results: int
    unavailable_results: int


class ModelLatencyAggregateResponse(LatencyAggregateResponse):
    """Latency values grouped by immutable model selection."""

    model_id: str
    model_name: str


class PromptLatencyAggregateResponse(LatencyAggregateResponse):
    prompt_version_id: UUID
    prompt_name: str
    prompt_version_number: int


class TokenAggregateResponse(BaseModel):
    """One token sum with explicit sample counts."""

    sum_tokens: int | None
    recorded_results: int
    unavailable_results: int


class ModelTokenAggregateResponse(BaseModel):
    """Token sums grouped by immutable model selection."""

    model_id: str
    model_name: str
    input_tokens: TokenAggregateResponse
    output_tokens: TokenAggregateResponse
    total_tokens: TokenAggregateResponse


class PromptTokenAggregateResponse(BaseModel):
    prompt_version_id: UUID
    prompt_name: str
    prompt_version_number: int
    input_tokens: TokenAggregateResponse
    output_tokens: TokenAggregateResponse
    total_tokens: TokenAggregateResponse


class PerformanceSummaryResponse(BaseModel):
    """Persisted latency and token usage for an evaluation."""

    latency: LatencyAggregateResponse
    latency_by_model: list[ModelLatencyAggregateResponse]
    latency_by_prompt_version: list[PromptLatencyAggregateResponse]
    input_tokens: TokenAggregateResponse
    output_tokens: TokenAggregateResponse
    total_tokens: TokenAggregateResponse
    token_usage_by_model: list[ModelTokenAggregateResponse]
    token_usage_by_prompt_version: list[PromptTokenAggregateResponse]


class CostAggregateResponse(BaseModel):
    """A partial cost total with explicit estimate availability."""

    estimated_usd: str | None
    priced_results: int
    unavailable_results: int


class ModelCostAggregateResponse(CostAggregateResponse):
    model_id: str
    model_name: str


class PromptCostAggregateResponse(CostAggregateResponse):
    prompt_version_id: UUID
    prompt_name: str
    prompt_version_number: int


class EvaluationCostSummaryResponse(BaseModel):
    """Estimated evaluation costs in USD from immutable price snapshots."""

    overall: CostAggregateResponse
    average_complete_test_case_usd: str | None
    complete_test_cases: int
    incomplete_test_cases: int
    by_model: list[ModelCostAggregateResponse]
    by_prompt_version: list[PromptCostAggregateResponse]


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
    pricing = None
    if (
        result.input_price_micro_usd_per_million is not None
        and result.output_price_micro_usd_per_million is not None
        and result.pricing_currency is not None
        and result.pricing_source is not None
        and result.pricing_effective_date is not None
    ):
        pricing = PricingSnapshotResponse(
            input_usd_per_million_tokens=micro_to_usd_string(
                result.input_price_micro_usd_per_million
            ),
            output_usd_per_million_tokens=micro_to_usd_string(
                result.output_price_micro_usd_per_million
            ),
            currency=result.pricing_currency,
            source=result.pricing_source,
            effective_date=result.pricing_effective_date,
            source_url=result.pricing_source_url,
        )
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
        test_category=result.test_category,
        case_type=result.case_type,
        security_test_type=result.security_test_type,
        security_metric_version=result.security_metric_version,
        security_status=(
            None
            if result.case_type == "standard"
            else (
                "passed"
                if result.security_passed is True
                else "failed"
                if result.security_passed is False
                else "unavailable"
            )
        ),
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
        total_tokens=result.total_tokens,
        pricing=pricing,
        estimated_cost_usd=(
            nano_to_usd_string(result.estimated_cost_nano_usd)
            if result.estimated_cost_nano_usd is not None
            else None
        ),
        quality_scores=[
            QualityScoreResponse(
                method=item.method,
                version=item.metric_version,
                score=item.score,
            )
            for item in sorted(
                result.quality_scores,
                key=lambda item: QUALITY_METRIC_ORDER.get(
                    (item.method, item.metric_version), len(QUALITY_METRIC_ORDER)
                ),
            )
        ],
        started_at=result.started_at,
        completed_at=result.completed_at,
    )


def _result_page_response(page: ResultPage) -> EvaluationResultPageResponse:
    return EvaluationResultPageResponse(
        items=[_result_response(item) for item in page.items],
        total=page.total,
        unfiltered_total=page.unfiltered_total,
        offset=page.offset,
        limit=page.limit,
        filter_options=ResultFilterOptionsResponse(
            models=[
                ResultFilterModelResponse(id=item.id, name=item.name)
                for item in page.filter_options.models
            ],
            prompt_versions=[
                ResultFilterPromptVersionResponse(
                    id=item.id, name=item.name, version_number=item.version_number
                )
                for item in page.filter_options.prompt_versions
            ],
            categories=page.filter_options.categories,
            has_uncategorized_category=page.filter_options.has_uncategorized_category,
        ),
    )


def _run_page_response(page: EvaluationRunPage) -> EvaluationRunPageResponse:
    return EvaluationRunPageResponse(
        items=[_run_history_response(item) for item in page.items],
        total=page.total,
        completed=page.completed,
        failed=page.failed,
        offset=page.offset,
        limit=page.limit,
    )


def _run_history_response(
    item: EvaluationRunArchiveItem,
) -> EvaluationRunHistoryResponse:
    return EvaluationRunHistoryResponse(
        **_run_response(item.run).model_dump(),
        models=[
            EvaluationRunModelResponse(id=model.id, name=model.name)
            for model in item.models
        ],
        prompt_versions=[
            EvaluationRunPromptVersionResponse(
                id=prompt.id,
                name=prompt.name,
                version_number=prompt.version_number,
            )
            for prompt in item.prompt_versions
        ],
    )


def _aggregate_response(aggregate: QualityAggregate) -> QualityAggregateResponse:
    return QualityAggregateResponse(
        average_score=aggregate.average_score,
        scored_results=aggregate.scored_results,
        unavailable_results=aggregate.unavailable_results,
    )


def _model_aggregate_response(
    item: ModelQualityAggregate,
) -> ModelQualityAggregateResponse:
    return ModelQualityAggregateResponse(
        model_id=item.model_id,
        model_name=item.model_name,
        **_aggregate_response(item.aggregate).model_dump(),
    )


def _prompt_aggregate_response(
    item: PromptQualityAggregate,
) -> PromptQualityAggregateResponse:
    return PromptQualityAggregateResponse(
        prompt_version_id=item.prompt_version_id,
        prompt_name=item.prompt_name,
        prompt_version_number=item.prompt_version_number,
        **_aggregate_response(item.aggregate).model_dump(),
    )


def _quality_summary_response(
    metrics: list[QualityMetricSummary],
) -> EvaluationQualitySummaryResponse:
    return EvaluationQualitySummaryResponse(
        metrics=[
            QualityMetricSummaryResponse(
                method=metric.method,
                version=metric.version,
                overall=_aggregate_response(metric.overall),
                by_model=[_model_aggregate_response(item) for item in metric.by_model],
                by_prompt_version=[
                    _prompt_aggregate_response(item)
                    for item in metric.by_prompt_version
                ],
            )
            for metric in metrics
        ]
    )


def _security_aggregate_response(
    aggregate: SecurityAggregate,
) -> SecurityAggregateResponse:
    return SecurityAggregateResponse(
        score=aggregate.score,
        total_tests=aggregate.total_tests,
        passed_tests=aggregate.passed_tests,
        failed_tests=aggregate.failed_tests,
        unavailable_tests=aggregate.unavailable_tests,
    )


def _security_summary_response(
    summary: SecuritySummary,
) -> EvaluationSecuritySummaryResponse:
    return EvaluationSecuritySummaryResponse(
        metric_version=summary.metric_version,
        overall=_security_aggregate_response(summary.overall),
        by_model=[
            ModelSecurityAggregateResponse(
                model_id=item.model_id,
                model_name=item.model_name,
                **_security_aggregate_response(item.aggregate).model_dump(),
            )
            for item in summary.by_model
        ],
        by_prompt_version=[
            PromptSecurityAggregateResponse(
                prompt_version_id=item.prompt_version_id,
                prompt_name=item.prompt_name,
                prompt_version_number=item.prompt_version_number,
                **_security_aggregate_response(item.aggregate).model_dump(),
            )
            for item in summary.by_prompt_version
        ],
    )


def _latency_response(aggregate: LatencyAggregate) -> LatencyAggregateResponse:
    return LatencyAggregateResponse(
        average_ms=aggregate.average_ms,
        minimum_ms=aggregate.minimum_ms,
        maximum_ms=aggregate.maximum_ms,
        recorded_results=aggregate.recorded_results,
        unavailable_results=aggregate.unavailable_results,
    )


def _model_latency_response(
    item: ModelLatencyAggregate,
) -> ModelLatencyAggregateResponse:
    return ModelLatencyAggregateResponse(
        model_id=item.model_id,
        model_name=item.model_name,
        **_latency_response(item.aggregate).model_dump(),
    )


def _prompt_latency_response(
    item: PromptLatencyAggregate,
) -> PromptLatencyAggregateResponse:
    return PromptLatencyAggregateResponse(
        prompt_version_id=item.prompt_version_id,
        prompt_name=item.prompt_name,
        prompt_version_number=item.prompt_version_number,
        **_latency_response(item.aggregate).model_dump(),
    )


def _token_response(aggregate: TokenAggregate) -> TokenAggregateResponse:
    return TokenAggregateResponse(
        sum_tokens=aggregate.sum_tokens,
        recorded_results=aggregate.recorded_results,
        unavailable_results=aggregate.unavailable_results,
    )


def _model_token_response(item: ModelTokenAggregate) -> ModelTokenAggregateResponse:
    return ModelTokenAggregateResponse(
        model_id=item.model_id,
        model_name=item.model_name,
        input_tokens=_token_response(item.input_tokens),
        output_tokens=_token_response(item.output_tokens),
        total_tokens=_token_response(item.total_tokens),
    )


def _prompt_token_response(item: PromptTokenAggregate) -> PromptTokenAggregateResponse:
    return PromptTokenAggregateResponse(
        prompt_version_id=item.prompt_version_id,
        prompt_name=item.prompt_name,
        prompt_version_number=item.prompt_version_number,
        input_tokens=_token_response(item.input_tokens),
        output_tokens=_token_response(item.output_tokens),
        total_tokens=_token_response(item.total_tokens),
    )


def _performance_summary_response(
    summary: PerformanceSummary,
) -> PerformanceSummaryResponse:
    return PerformanceSummaryResponse(
        latency=_latency_response(summary.latency),
        latency_by_model=[
            _model_latency_response(item) for item in summary.latency_by_model
        ],
        latency_by_prompt_version=[
            _prompt_latency_response(item) for item in summary.latency_by_prompt_version
        ],
        input_tokens=_token_response(summary.input_tokens),
        output_tokens=_token_response(summary.output_tokens),
        total_tokens=_token_response(summary.total_tokens),
        token_usage_by_model=[
            _model_token_response(item) for item in summary.token_usage_by_model
        ],
        token_usage_by_prompt_version=[
            _prompt_token_response(item)
            for item in summary.token_usage_by_prompt_version
        ],
    )


def _cost_aggregate_response(aggregate: CostAggregate) -> CostAggregateResponse:
    return CostAggregateResponse(
        estimated_usd=(
            nano_to_usd_string(aggregate.total_nano_usd)
            if aggregate.total_nano_usd is not None
            else None
        ),
        priced_results=aggregate.priced_results,
        unavailable_results=aggregate.unavailable_results,
    )


def _model_cost_response(item: ModelCostAggregate) -> ModelCostAggregateResponse:
    return ModelCostAggregateResponse(
        model_id=item.model_id,
        model_name=item.model_name,
        **_cost_aggregate_response(item.aggregate).model_dump(),
    )


def _prompt_cost_response(item: PromptCostAggregate) -> PromptCostAggregateResponse:
    return PromptCostAggregateResponse(
        prompt_version_id=item.prompt_version_id,
        prompt_name=item.prompt_name,
        prompt_version_number=item.prompt_version_number,
        **_cost_aggregate_response(item.aggregate).model_dump(),
    )


def _cost_summary_response(summary: CostSummary) -> EvaluationCostSummaryResponse:
    return EvaluationCostSummaryResponse(
        overall=_cost_aggregate_response(summary.overall),
        average_complete_test_case_usd=(
            nano_to_usd_string(summary.average_complete_test_case_nano_usd)
            if summary.average_complete_test_case_nano_usd is not None
            else None
        ),
        complete_test_cases=summary.complete_test_cases,
        incomplete_test_cases=summary.incomplete_test_cases,
        by_model=[_model_cost_response(item) for item in summary.by_model],
        by_prompt_version=[
            _prompt_cost_response(item) for item in summary.by_prompt_version
        ],
    )


def _raise_evaluation_error(exc: Exception) -> NoReturn:
    if isinstance(
        exc,
        (
            EvaluationDatasetNotFoundError,
            EvaluationRunNotFoundError,
            PerformanceEvaluationNotFoundError,
            QualityEvaluationNotFoundError,
            CostEvaluationNotFoundError,
            SecurityEvaluationNotFoundError,
        ),
    ):
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
    "/{evaluation_id}/quality-summary",
    response_model=EvaluationQualitySummaryResponse,
)
async def read_evaluation_quality_summary(
    evaluation_id: UUID,
    session: DatabaseSession,
) -> EvaluationQualitySummaryResponse:
    """Return quality aggregates with explicit sample counts."""
    try:
        metrics = await get_quality_summary(session, evaluation_id)
    except QualityEvaluationNotFoundError as exc:
        _raise_evaluation_error(exc)
    return _quality_summary_response(metrics)


@router.get(
    "/{evaluation_id}/security-summary",
    response_model=EvaluationSecuritySummaryResponse,
)
async def read_evaluation_security_summary(
    evaluation_id: UUID,
    session: DatabaseSession,
) -> EvaluationSecuritySummaryResponse:
    """Return conservative security scores and explicit unavailable counts."""
    try:
        summary = await get_security_summary(session, evaluation_id)
    except SecurityEvaluationNotFoundError as exc:
        _raise_evaluation_error(exc)
    return _security_summary_response(summary)


@router.get(
    "/{evaluation_id}/performance-summary",
    response_model=PerformanceSummaryResponse,
)
async def read_evaluation_performance_summary(
    evaluation_id: UUID,
    session: DatabaseSession,
) -> PerformanceSummaryResponse:
    """Return latency and token aggregates with explicit sample counts."""
    try:
        summary = await get_performance_summary(session, evaluation_id)
    except PerformanceEvaluationNotFoundError as exc:
        _raise_evaluation_error(exc)
    return _performance_summary_response(summary)


@router.get(
    "/{evaluation_id}/cost-summary",
    response_model=EvaluationCostSummaryResponse,
)
async def read_evaluation_cost_summary(
    evaluation_id: UUID,
    session: DatabaseSession,
) -> EvaluationCostSummaryResponse:
    """Return estimated costs with explicit incomplete coverage."""
    try:
        summary = await get_cost_summary(session, evaluation_id)
    except CostEvaluationNotFoundError as exc:
        _raise_evaluation_error(exc)
    return _cost_summary_response(summary)


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
    model_id: Annotated[list[str], Query()] = [],
    prompt_version_id: Annotated[list[UUID], Query()] = [],
    category: Annotated[list[str], Query()] = [],
    uncategorized: bool = False,
    outcome: Literal["passed", "failed", "unavailable"] | None = None,
    case_type: Literal["standard", "security"] | None = None,
) -> EvaluationResultPageResponse:
    """Return one bounded page of stored result snapshots."""
    try:
        page = await list_evaluation_results(
            session,
            evaluation_id,
            offset=offset,
            limit=limit,
            filters=ResultFilters(
                model_ids=tuple(model_id),
                prompt_version_ids=tuple(prompt_version_id),
                categories=tuple(category),
                include_uncategorized_category=uncategorized,
                outcome=outcome,
                case_type=case_type,
            ),
        )
    except EvaluationRunNotFoundError as exc:
        _raise_evaluation_error(exc)
    return _result_page_response(page)
