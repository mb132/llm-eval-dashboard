"""Aggregations for persisted evaluation latency and token usage."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import EvaluationResult, EvaluationRun


class PerformanceEvaluationNotFoundError(LookupError):
    """Raised when performance was requested for an unknown evaluation."""


@dataclass(frozen=True, slots=True)
class LatencyAggregate:
    """Full-response latency with explicit availability counts."""

    average_ms: float | None
    minimum_ms: int | None
    maximum_ms: int | None
    recorded_results: int
    unavailable_results: int


@dataclass(frozen=True, slots=True)
class ModelLatencyAggregate:
    """Latency aggregation for one immutable model selection."""

    model_id: str
    model_name: str
    aggregate: LatencyAggregate


@dataclass(frozen=True, slots=True)
class TokenAggregate:
    """Token sum with explicit availability counts."""

    sum_tokens: int | None
    recorded_results: int
    unavailable_results: int


@dataclass(frozen=True, slots=True)
class PerformanceSummary:
    """Latency and token usage for one evaluation."""

    latency: LatencyAggregate
    latency_by_model: list[ModelLatencyAggregate]
    input_tokens: TokenAggregate
    output_tokens: TokenAggregate
    total_tokens: TokenAggregate


async def get_performance_summary(
    session: AsyncSession, evaluation_id: UUID
) -> PerformanceSummary:
    """Aggregate recorded execution metrics without treating missing values as zero."""
    if await session.get(EvaluationRun, evaluation_id) is None:
        raise PerformanceEvaluationNotFoundError("Evaluation not found.")
    return PerformanceSummary(
        latency=await _overall_latency(session, evaluation_id),
        latency_by_model=await _latency_by_model(session, evaluation_id),
        **await _token_aggregates(session, evaluation_id),
    )


def _latency_aggregate(
    average: float | None,
    minimum: int | None,
    maximum: int | None,
    recorded: int,
    total: int,
) -> LatencyAggregate:
    return LatencyAggregate(
        average_ms=float(average) if average is not None else None,
        minimum_ms=minimum,
        maximum_ms=maximum,
        recorded_results=recorded,
        unavailable_results=total - recorded,
    )


async def _overall_latency(
    session: AsyncSession, evaluation_id: UUID
) -> LatencyAggregate:
    statement = select(
        func.avg(EvaluationResult.latency_ms),
        func.min(EvaluationResult.latency_ms),
        func.max(EvaluationResult.latency_ms),
        func.count(EvaluationResult.latency_ms),
        func.count(EvaluationResult.id),
    ).where(EvaluationResult.evaluation_id == evaluation_id)
    return _latency_aggregate(*(await session.execute(statement)).one())


async def _latency_by_model(
    session: AsyncSession, evaluation_id: UUID
) -> list[ModelLatencyAggregate]:
    statement = (
        select(
            EvaluationResult.model_id,
            EvaluationResult.model_name,
            func.avg(EvaluationResult.latency_ms),
            func.min(EvaluationResult.latency_ms),
            func.max(EvaluationResult.latency_ms),
            func.count(EvaluationResult.latency_ms),
            func.count(EvaluationResult.id),
        )
        .where(EvaluationResult.evaluation_id == evaluation_id)
        .group_by(EvaluationResult.model_id, EvaluationResult.model_name)
        .order_by(EvaluationResult.model_name, EvaluationResult.model_id)
    )
    return [
        ModelLatencyAggregate(
            model_id=model_id,
            model_name=model_name,
            aggregate=_latency_aggregate(average, minimum, maximum, recorded, total),
        )
        for model_id, model_name, average, minimum, maximum, recorded, total in (
            await session.execute(statement)
        )
    ]


def _token_aggregate(value: int | None, recorded: int, total: int) -> TokenAggregate:
    return TokenAggregate(
        sum_tokens=int(value) if value is not None else None,
        recorded_results=recorded,
        unavailable_results=total - recorded,
    )


async def _token_aggregates(
    session: AsyncSession, evaluation_id: UUID
) -> dict[str, TokenAggregate]:
    statement = select(
        func.sum(EvaluationResult.input_tokens),
        func.count(EvaluationResult.input_tokens),
        func.sum(EvaluationResult.output_tokens),
        func.count(EvaluationResult.output_tokens),
        func.sum(EvaluationResult.total_tokens),
        func.count(EvaluationResult.total_tokens),
        func.count(EvaluationResult.id),
    ).where(EvaluationResult.evaluation_id == evaluation_id)
    input_sum, input_count, output_sum, output_count, total_sum, total_count, count = (
        await session.execute(statement)
    ).one()
    return {
        "input_tokens": _token_aggregate(input_sum, input_count, count),
        "output_tokens": _token_aggregate(output_sum, output_count, count),
        "total_tokens": _token_aggregate(total_sum, total_count, count),
    }
