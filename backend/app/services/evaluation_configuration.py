"""Evaluation option discovery and side-effect-free configuration validation."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.functions import count as sql_count

from ..models import Dataset, ModelConfiguration, Prompt, PromptVersion, TestCase
from .model_service import unavailable_reason

MAX_SELECTED_MODELS = 10
MAX_SELECTED_PROMPT_VERSIONS = 20
MAX_REPETITIONS = 5
MAX_TOTAL_REQUESTS = 1_000
PROMPT_PREVIEW_LENGTH = 160


class EvaluationConfigurationError(ValueError):
    """Raised when selected evaluation options cannot form a safe run."""


class EvaluationDatasetNotFoundError(LookupError):
    """Raised when the selected evaluation dataset does not exist."""


@dataclass(frozen=True, slots=True)
class ModelOption:
    """Normalized model choice independent of a provider implementation."""

    id: str
    provider: str
    name: str
    model_name: str


@dataclass(frozen=True, slots=True)
class PromptVersionOption:
    """Prompt-version choice used by the configuration interface."""

    id: UUID
    prompt_id: UUID
    prompt_name: str
    version_number: int
    content_preview: str
    system_prompt_preview: str | None


@dataclass(frozen=True, slots=True)
class DatasetOption:
    """Dataset choice and its current number of test cases."""

    id: UUID
    name: str
    test_case_count: int


@dataclass(frozen=True, slots=True)
class EvaluationOptions:
    """All currently selectable evaluation inputs."""

    models: list[ModelOption]
    prompt_versions: list[PromptVersionOption]
    datasets: list[DatasetOption]


@dataclass(frozen=True, slots=True)
class EvaluationPreview:
    """Validated request counts for a future evaluation run."""

    model_ids: list[str]
    prompt_version_ids: list[UUID]
    dataset_id: UUID
    repetitions: int
    model_count: int
    prompt_version_count: int
    test_case_count: int
    combination_count: int
    total_requests: int


async def get_evaluation_model_options(
    session: AsyncSession,
) -> list[ModelOption]:
    """Return active persisted models with a supported execution protocol."""
    statement = (
        select(ModelConfiguration)
        .options(selectinload(ModelConfiguration.provider))
        .where(ModelConfiguration.active.is_(True))
        .order_by(ModelConfiguration.display_name.asc(), ModelConfiguration.id.asc())
    )
    configured_models = list(await session.scalars(statement))
    return [
        ModelOption(
            id=str(model.id),
            provider=model.provider.kind,
            name=model.display_name,
            model_name=model.model_name,
        )
        for model in configured_models
        if unavailable_reason(model) is None
    ]


async def get_evaluation_options(
    session: AsyncSession,
    *,
    models: list[ModelOption],
) -> EvaluationOptions:
    """Load prompt versions and datasets alongside normalized model choices."""
    prompt_statement = (
        select(PromptVersion, Prompt.name)
        .join(Prompt, Prompt.id == PromptVersion.prompt_id)
        .order_by(Prompt.name.asc(), PromptVersion.version_number.desc())
    )
    prompt_rows = (await session.execute(prompt_statement)).all()

    dataset_statement = (
        select(Dataset, sql_count(TestCase.id).label("test_case_count"))
        .outerjoin(TestCase, TestCase.dataset_id == Dataset.id)
        .group_by(Dataset.id)
        .order_by(Dataset.name.asc())
    )
    dataset_rows = (await session.execute(dataset_statement)).all()

    return EvaluationOptions(
        models=models,
        prompt_versions=[
            PromptVersionOption(
                id=version.id,
                prompt_id=version.prompt_id,
                prompt_name=prompt_name,
                version_number=version.version_number,
                content_preview=_prompt_preview(version.content),
                system_prompt_preview=(
                    _prompt_preview(version.system_prompt)
                    if version.system_prompt
                    else None
                ),
            )
            for version, prompt_name in prompt_rows
        ],
        datasets=[
            DatasetOption(
                id=dataset.id,
                name=dataset.name,
                test_case_count=test_case_count,
            )
            for dataset, test_case_count in dataset_rows
        ],
    )


async def preview_evaluation_configuration(
    session: AsyncSession,
    *,
    models: list[ModelOption],
    model_ids: list[str],
    prompt_version_ids: list[UUID],
    dataset_id: UUID,
    repetitions: int,
) -> EvaluationPreview:
    """Validate current selections and calculate bounded execution cardinality."""
    available_model_ids = {model.id for model in models}
    if any(model_id not in available_model_ids for model_id in model_ids):
        raise EvaluationConfigurationError(
            "One or more selected models are no longer available."
        )

    existing_prompt_ids = set(
        await session.scalars(
            select(PromptVersion.id).where(PromptVersion.id.in_(prompt_version_ids))
        )
    )
    if existing_prompt_ids != set(prompt_version_ids):
        raise EvaluationConfigurationError(
            "One or more selected prompt versions no longer exist."
        )

    dataset = await session.get(Dataset, dataset_id)
    if dataset is None:
        raise EvaluationDatasetNotFoundError("Dataset not found.")
    test_case_count = await session.scalar(
        select(sql_count(TestCase.id)).where(TestCase.dataset_id == dataset_id)
    )
    if not test_case_count:
        raise EvaluationConfigurationError(
            "The selected dataset does not contain any test cases."
        )

    combination_count = len(model_ids) * len(prompt_version_ids)
    total_requests = combination_count * test_case_count * repetitions
    if total_requests > MAX_TOTAL_REQUESTS:
        raise EvaluationConfigurationError(
            "This configuration would create too many model requests. "
            f"Reduce the selection to at most {MAX_TOTAL_REQUESTS} requests."
        )

    return EvaluationPreview(
        model_ids=model_ids,
        prompt_version_ids=prompt_version_ids,
        dataset_id=dataset_id,
        repetitions=repetitions,
        model_count=len(model_ids),
        prompt_version_count=len(prompt_version_ids),
        test_case_count=test_case_count,
        combination_count=combination_count,
        total_requests=total_requests,
    )


def _prompt_preview(content: str) -> str:
    """Create a compact plain-text preview without interpreting prompt content."""
    return " ".join(content.split())[:PROMPT_PREVIEW_LENGTH]
