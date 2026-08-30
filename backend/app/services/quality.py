"""Deterministic response-quality metrics and their aggregations."""

import unicodedata
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import EvaluationQualityScore, EvaluationResult, EvaluationRun


@dataclass(frozen=True, slots=True)
class QualityMetricDefinition:
    """Stable identity for one reproducible metric implementation."""

    method: str
    version: int


EXACT_MATCH = QualityMetricDefinition(method="normalized_exact_match", version=1)
CONTAINS_MATCH = QualityMetricDefinition(method="normalized_contains_match", version=1)
QUALITY_METRICS = (EXACT_MATCH, CONTAINS_MATCH)


class QualityEvaluationNotFoundError(LookupError):
    """Raised when quality was requested for an unknown evaluation."""


@dataclass(frozen=True, slots=True)
class QualityAggregate:
    """One score average with an explicit denominator and missing count."""

    average_score: float | None
    scored_results: int
    unavailable_results: int


@dataclass(frozen=True, slots=True)
class ModelQualityAggregate:
    """Quality aggregation for one immutable model selection."""

    model_id: str
    model_name: str
    aggregate: QualityAggregate


@dataclass(frozen=True, slots=True)
class PromptQualityAggregate:
    """Quality aggregation for one immutable prompt version."""

    prompt_version_id: UUID
    prompt_name: str
    prompt_version_number: int
    aggregate: QualityAggregate


@dataclass(frozen=True, slots=True)
class QualityMetricSummary:
    """Overall and grouped values for one metric version."""

    method: str
    version: int
    overall: QualityAggregate
    by_model: list[ModelQualityAggregate]
    by_prompt_version: list[PromptQualityAggregate]


def normalize_quality_text(value: str) -> str:
    """Normalize Unicode, casing, and whitespace while preserving punctuation."""
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(normalized.split())


def score_response(*, expected: str, generated: str) -> dict[tuple[str, int], float]:
    """Calculate every deterministic metric for one successful response."""
    normalized_expected = normalize_quality_text(expected)
    normalized_generated = normalize_quality_text(generated)
    return {
        (EXACT_MATCH.method, EXACT_MATCH.version): float(
            normalized_generated == normalized_expected
        ),
        (CONTAINS_MATCH.method, CONTAINS_MATCH.version): float(
            bool(normalized_expected) and normalized_expected in normalized_generated
        ),
    }


async def get_quality_summary(
    session: AsyncSession, evaluation_id: UUID
) -> list[QualityMetricSummary]:
    """Aggregate each metric by evaluation, model, and prompt version."""
    if await session.get(EvaluationRun, evaluation_id) is None:
        raise QualityEvaluationNotFoundError("Evaluation not found.")
    return [
        QualityMetricSummary(
            method=metric.method,
            version=metric.version,
            overall=await _overall_aggregate(session, evaluation_id, metric),
            by_model=await _model_aggregates(session, evaluation_id, metric),
            by_prompt_version=await _prompt_aggregates(session, evaluation_id, metric),
        )
        for metric in QUALITY_METRICS
    ]


def _score_join(metric: QualityMetricDefinition):
    return and_(
        EvaluationQualityScore.result_id == EvaluationResult.id,
        EvaluationQualityScore.method == metric.method,
        EvaluationQualityScore.metric_version == metric.version,
    )


def _aggregate(average: float | None, scored: int, total: int) -> QualityAggregate:
    return QualityAggregate(
        average_score=float(average) if average is not None else None,
        scored_results=scored,
        unavailable_results=total - scored,
    )


async def _overall_aggregate(
    session: AsyncSession,
    evaluation_id: UUID,
    metric: QualityMetricDefinition,
) -> QualityAggregate:
    statement = (
        select(
            func.avg(EvaluationQualityScore.score),
            func.count(EvaluationQualityScore.score),
            func.count(EvaluationResult.id),
        )
        .select_from(EvaluationResult)
        .outerjoin(EvaluationQualityScore, _score_join(metric))
        .where(EvaluationResult.evaluation_id == evaluation_id)
    )
    average, scored, total = (await session.execute(statement)).one()
    return _aggregate(average, scored, total)


async def _model_aggregates(
    session: AsyncSession,
    evaluation_id: UUID,
    metric: QualityMetricDefinition,
) -> list[ModelQualityAggregate]:
    statement = (
        select(
            EvaluationResult.model_id,
            EvaluationResult.model_name,
            func.avg(EvaluationQualityScore.score),
            func.count(EvaluationQualityScore.score),
            func.count(EvaluationResult.id),
        )
        .select_from(EvaluationResult)
        .outerjoin(EvaluationQualityScore, _score_join(metric))
        .where(EvaluationResult.evaluation_id == evaluation_id)
        .group_by(EvaluationResult.model_id, EvaluationResult.model_name)
        .order_by(EvaluationResult.model_name, EvaluationResult.model_id)
    )
    return [
        ModelQualityAggregate(
            model_id=model_id,
            model_name=model_name,
            aggregate=_aggregate(average, scored, total),
        )
        for model_id, model_name, average, scored, total in await session.execute(
            statement
        )
    ]


async def _prompt_aggregates(
    session: AsyncSession,
    evaluation_id: UUID,
    metric: QualityMetricDefinition,
) -> list[PromptQualityAggregate]:
    statement = (
        select(
            EvaluationResult.prompt_version_id,
            EvaluationResult.prompt_name,
            EvaluationResult.prompt_version_number,
            func.avg(EvaluationQualityScore.score),
            func.count(EvaluationQualityScore.score),
            func.count(EvaluationResult.id),
        )
        .select_from(EvaluationResult)
        .outerjoin(EvaluationQualityScore, _score_join(metric))
        .where(EvaluationResult.evaluation_id == evaluation_id)
        .group_by(
            EvaluationResult.prompt_version_id,
            EvaluationResult.prompt_name,
            EvaluationResult.prompt_version_number,
        )
        .order_by(
            EvaluationResult.prompt_name,
            EvaluationResult.prompt_version_number,
            EvaluationResult.prompt_version_id,
        )
    )
    return [
        PromptQualityAggregate(
            prompt_version_id=version_id,
            prompt_name=prompt_name,
            prompt_version_number=version_number,
            aggregate=_aggregate(average, scored, total),
        )
        for version_id, prompt_name, version_number, average, scored, total in (
            await session.execute(statement)
        )
    ]
