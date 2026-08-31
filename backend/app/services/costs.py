"""Cost aggregation over immutable evaluation result snapshots."""

from collections import defaultdict
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import EvaluationResult, EvaluationRun


class CostEvaluationNotFoundError(LookupError):
    """Raised when costs were requested for an unknown evaluation."""


@dataclass(frozen=True, slots=True)
class CostAggregate:
    total_nano_usd: int | None
    priced_results: int
    unavailable_results: int


@dataclass(frozen=True, slots=True)
class ModelCostAggregate:
    model_id: str
    model_name: str
    aggregate: CostAggregate


@dataclass(frozen=True, slots=True)
class CostSummary:
    overall: CostAggregate
    average_complete_test_case_nano_usd: int | None
    complete_test_cases: int
    incomplete_test_cases: int
    by_model: list[ModelCostAggregate]


def _aggregate(costs: list[int | None]) -> CostAggregate:
    priced = [cost for cost in costs if cost is not None]
    return CostAggregate(
        total_nano_usd=sum(priced) if priced else None,
        priced_results=len(priced),
        unavailable_results=len(costs) - len(priced),
    )


async def get_cost_summary(session: AsyncSession, evaluation_id: UUID) -> CostSummary:
    """Aggregate estimates while making partial coverage explicit."""
    if await session.get(EvaluationRun, evaluation_id) is None:
        raise CostEvaluationNotFoundError("Evaluation not found.")
    rows = list(
        await session.execute(
            select(
                EvaluationResult.model_id,
                EvaluationResult.model_name,
                EvaluationResult.test_case_id,
                EvaluationResult.estimated_cost_nano_usd,
            )
            .where(EvaluationResult.evaluation_id == evaluation_id)
            .order_by(EvaluationResult.sequence_number)
        )
    )
    by_model: dict[tuple[str, str], list[int | None]] = defaultdict(list)
    by_test_case: dict[UUID, list[int | None]] = defaultdict(list)
    all_costs: list[int | None] = []
    for model_id, model_name, test_case_id, cost in rows:
        all_costs.append(cost)
        by_model[(model_id, model_name)].append(cost)
        by_test_case[test_case_id].append(cost)

    complete_case_costs = [
        sum(cost for cost in costs if cost is not None)
        for costs in by_test_case.values()
        if costs and all(cost is not None for cost in costs)
    ]
    average = None
    if complete_case_costs:
        average = int(
            (Decimal(sum(complete_case_costs)) / len(complete_case_costs)).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
    return CostSummary(
        overall=_aggregate(all_costs),
        average_complete_test_case_nano_usd=average,
        complete_test_cases=len(complete_case_costs),
        incomplete_test_cases=len(by_test_case) - len(complete_case_costs),
        by_model=[
            ModelCostAggregate(
                model_id=model_id,
                model_name=model_name,
                aggregate=_aggregate(costs),
            )
            for (model_id, model_name), costs in sorted(
                by_model.items(), key=lambda item: (item[0][1], item[0][0])
            )
        ],
    )
