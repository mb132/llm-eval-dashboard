"""Creation, execution, and retrieval of persistent evaluation runs."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from ..database import SessionFactory
from ..models import (
    Dataset,
    EvaluationResult,
    EvaluationRun,
    Prompt,
    PromptVersion,
)
from ..models.base import utc_now
from .evaluation_configuration import (
    EvaluationConfigurationError,
    ModelOption,
    preview_evaluation_configuration,
)
from .ollama import (
    MAX_OUTPUT_TOKENS,
    REQUEST_TIMEOUT_SECONDS,
    OllamaError,
    OllamaResult,
    generate_ollama_response,
)
from .prompts import INPUT_PLACEHOLDER

MAX_CONCURRENT_MODEL_REQUESTS = 4
MAX_ERROR_MESSAGE_LENGTH = 500
DEFAULT_RESULT_PAGE_SIZE = 50
MAX_RESULT_PAGE_SIZE = 100

type ProviderCall = Callable[..., Awaitable[OllamaResult]]

logger = logging.getLogger(__name__)
_model_request_semaphore = asyncio.Semaphore(MAX_CONCURRENT_MODEL_REQUESTS)


class EvaluationRunNotFoundError(LookupError):
    """Raised when a requested evaluation run does not exist."""


@dataclass(frozen=True, slots=True)
class ResultPage:
    """One stable page of evaluation results."""

    items: list[EvaluationResult]
    total: int
    offset: int
    limit: int


@dataclass(frozen=True, slots=True)
class _ExecutionSnapshot:
    """Provider input detached from the database session."""

    result_id: UUID
    provider: str
    model: str
    prompt: str


async def create_evaluation_run(
    session: AsyncSession,
    *,
    models: list[ModelOption],
    model_ids: list[str],
    prompt_version_ids: list[UUID],
    dataset_id: UUID,
    repetitions: int,
) -> EvaluationRun:
    """Validate a configuration and atomically persist all immutable snapshots."""
    preview = await preview_evaluation_configuration(
        session,
        models=models,
        model_ids=model_ids,
        prompt_version_ids=prompt_version_ids,
        dataset_id=dataset_id,
        repetitions=repetitions,
    )
    dataset_statement = (
        select(Dataset)
        .where(Dataset.id == dataset_id)
        .options(selectinload(Dataset.test_cases))
    )
    dataset = (await session.scalars(dataset_statement)).one()
    dataset.test_cases.sort(key=lambda item: (item.created_at, str(item.id)))

    prompt_statement = (
        select(PromptVersion, Prompt.name)
        .join(Prompt, Prompt.id == PromptVersion.prompt_id)
        .where(PromptVersion.id.in_(prompt_version_ids))
    )
    prompt_rows = (await session.execute(prompt_statement)).all()
    prompts_by_id = {
        version.id: (version, prompt_name) for version, prompt_name in prompt_rows
    }
    models_by_id = {model.id: model for model in models}

    evaluation = EvaluationRun(
        status="pending",
        dataset_id=dataset.id,
        dataset_name=dataset.name,
        repetitions=repetitions,
        total_requests=preview.total_requests,
    )
    sequence_number = 1
    for model_id in model_ids:
        model = models_by_id[model_id]
        for prompt_version_id in prompt_version_ids:
            version, prompt_name = prompts_by_id[prompt_version_id]
            for test_case in dataset.test_cases:
                rendered_prompt = version.content.replace(
                    INPUT_PLACEHOLDER, test_case.input
                )
                for repetition in range(1, repetitions + 1):
                    evaluation.results.append(
                        EvaluationResult(
                            sequence_number=sequence_number,
                            status="pending",
                            model_id=model.id,
                            model_provider=model.provider,
                            model_name=model.name,
                            prompt_id=version.prompt_id,
                            prompt_version_id=version.id,
                            prompt_name=prompt_name,
                            prompt_version_number=version.version_number,
                            test_case_id=test_case.id,
                            repetition=repetition,
                            max_output_tokens=MAX_OUTPUT_TOKENS,
                            rendered_prompt=rendered_prompt,
                            test_input=test_case.input,
                            expected_output=test_case.expected_answer,
                        )
                    )
                    sequence_number += 1

    if sequence_number - 1 != preview.total_requests:
        raise EvaluationConfigurationError(
            "The evaluation inputs changed while the run was being created."
        )
    session.add(evaluation)
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return evaluation


async def get_evaluation_run(
    session: AsyncSession, evaluation_id: UUID
) -> EvaluationRun:
    """Return one run without loading its potentially large result collection."""
    evaluation = await session.get(EvaluationRun, evaluation_id)
    if evaluation is None:
        raise EvaluationRunNotFoundError("Evaluation not found.")
    return evaluation


async def list_evaluation_results(
    session: AsyncSession,
    evaluation_id: UUID,
    *,
    offset: int,
    limit: int,
) -> ResultPage:
    """Return one bounded page of result snapshots in execution order."""
    if await session.get(EvaluationRun, evaluation_id) is None:
        raise EvaluationRunNotFoundError("Evaluation not found.")
    total = await session.scalar(
        select(func.count(EvaluationResult.id)).where(
            EvaluationResult.evaluation_id == evaluation_id
        )
    )
    statement = (
        select(EvaluationResult)
        .where(EvaluationResult.evaluation_id == evaluation_id)
        .order_by(EvaluationResult.sequence_number)
        .offset(offset)
        .limit(limit)
    )
    items = list(await session.scalars(statement))
    return ResultPage(
        items=items,
        total=total or 0,
        offset=offset,
        limit=limit,
    )


async def execute_evaluation_run(
    evaluation_id: UUID,
    *,
    session_factory: async_sessionmaker[AsyncSession] = SessionFactory,
    provider_call: ProviderCall = generate_ollama_response,
    semaphore: asyncio.Semaphore = _model_request_semaphore,
) -> None:
    """Execute pending result snapshots and persist every outcome independently."""
    try:
        snapshots = await _start_run(session_factory, evaluation_id)
        if snapshots is None:
            return
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            async with asyncio.TaskGroup() as task_group:
                for snapshot in snapshots:
                    task_group.create_task(
                        _execute_result(
                            snapshot,
                            session_factory=session_factory,
                            provider_call=provider_call,
                            client=client,
                            semaphore=semaphore,
                        )
                    )
        await _complete_run(session_factory, evaluation_id)
    except Exception as exc:
        logger.error(
            "Evaluation %s failed with %s",
            evaluation_id,
            type(exc).__name__,
        )
        await _fail_run(
            session_factory,
            evaluation_id,
            message="The evaluation was interrupted by an internal execution error.",
            error_code="execution_error",
        )


async def fail_interrupted_runs(
    session_factory: async_sessionmaker[AsyncSession] = SessionFactory,
) -> None:
    """Mark work left active by a previous process as failed without replaying it."""
    async with session_factory() as session:
        evaluation_ids = list(
            await session.scalars(
                select(EvaluationRun.id).where(
                    EvaluationRun.status.in_(("pending", "running"))
                )
            )
        )
    for evaluation_id in evaluation_ids:
        await _fail_run(
            session_factory,
            evaluation_id,
            message="The evaluation was interrupted by a server restart.",
            error_code="interrupted",
        )


async def _start_run(
    session_factory: async_sessionmaker[AsyncSession], evaluation_id: UUID
) -> list[_ExecutionSnapshot] | None:
    async with session_factory() as session, session.begin():
        statement = (
            select(EvaluationRun)
            .where(EvaluationRun.id == evaluation_id)
            .options(selectinload(EvaluationRun.results))
        )
        evaluation = (await session.scalars(statement)).one_or_none()
        if evaluation is None or evaluation.status != "pending":
            return None
        evaluation.status = "running"
        evaluation.started_at = utc_now()
        return [
            _ExecutionSnapshot(
                result_id=result.id,
                provider=result.model_provider,
                model=result.model_name,
                prompt=result.rendered_prompt,
            )
            for result in sorted(
                evaluation.results, key=lambda item: item.sequence_number
            )
        ]


async def _execute_result(
    snapshot: _ExecutionSnapshot,
    *,
    session_factory: async_sessionmaker[AsyncSession],
    provider_call: ProviderCall,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> None:
    try:
        async with semaphore:
            await _mark_result_running(session_factory, snapshot.result_id)
            if snapshot.provider != "ollama":
                raise OllamaError(
                    "The selected model provider is not supported by this server.",
                    code="unsupported_provider",
                )
            outcome = await provider_call(
                snapshot.prompt, snapshot.model, client=client
            )
    except OllamaError as exc:
        await _store_result_failure(
            session_factory,
            snapshot.result_id,
            error_code=exc.code,
            error_message=str(exc),
        )
        return
    await _store_result_success(session_factory, snapshot.result_id, outcome)


async def _mark_result_running(
    session_factory: async_sessionmaker[AsyncSession], result_id: UUID
) -> None:
    async with session_factory() as session, session.begin():
        result = await session.get(EvaluationResult, result_id)
        if result is not None and result.status == "pending":
            result.status = "running"
            result.started_at = utc_now()


async def _store_result_success(
    session_factory: async_sessionmaker[AsyncSession],
    result_id: UUID,
    outcome: OllamaResult,
) -> None:
    now = utc_now()
    async with session_factory() as session, session.begin():
        result = await session.get(EvaluationResult, result_id)
        if result is None or result.status != "running":
            return
        result.status = "succeeded"
        result.reported_model_name = outcome.model
        result.generated_output = outcome.response
        result.latency_ms = outcome.latency_ms
        result.input_tokens = outcome.input_tokens
        result.output_tokens = outcome.output_tokens
        result.completed_at = now
        await session.execute(
            update(EvaluationRun)
            .where(EvaluationRun.id == result.evaluation_id)
            .values(
                completed_requests=EvaluationRun.completed_requests + 1,
                successful_requests=EvaluationRun.successful_requests + 1,
            )
        )


async def _store_result_failure(
    session_factory: async_sessionmaker[AsyncSession],
    result_id: UUID,
    *,
    error_code: str,
    error_message: str,
) -> None:
    now = utc_now()
    async with session_factory() as session, session.begin():
        result = await session.get(EvaluationResult, result_id)
        if result is None or result.status != "running":
            return
        result.status = "failed"
        result.error_code = error_code[:50]
        result.error_message = error_message[:MAX_ERROR_MESSAGE_LENGTH]
        result.completed_at = now
        await session.execute(
            update(EvaluationRun)
            .where(EvaluationRun.id == result.evaluation_id)
            .values(
                completed_requests=EvaluationRun.completed_requests + 1,
                failed_requests=EvaluationRun.failed_requests + 1,
            )
        )


async def _complete_run(
    session_factory: async_sessionmaker[AsyncSession], evaluation_id: UUID
) -> None:
    async with session_factory() as session, session.begin():
        evaluation = await session.get(EvaluationRun, evaluation_id)
        if evaluation is None or evaluation.status != "running":
            return
        if evaluation.completed_requests != evaluation.total_requests:
            raise RuntimeError("Evaluation execution finished with missing results.")
        evaluation.status = "completed"
        evaluation.completed_at = utc_now()


async def _fail_run(
    session_factory: async_sessionmaker[AsyncSession],
    evaluation_id: UUID,
    *,
    message: str,
    error_code: str,
) -> None:
    now = utc_now()
    async with session_factory() as session, session.begin():
        statement = (
            select(EvaluationRun)
            .where(EvaluationRun.id == evaluation_id)
            .options(selectinload(EvaluationRun.results))
        )
        evaluation = (await session.scalars(statement)).one_or_none()
        if evaluation is None or evaluation.status in ("completed", "failed"):
            return
        for result in evaluation.results:
            if result.status in ("pending", "running"):
                result.status = "failed"
                result.error_code = error_code
                result.error_message = message
                result.completed_at = now
        evaluation.completed_requests = len(evaluation.results)
        evaluation.successful_requests = sum(
            result.status == "succeeded" for result in evaluation.results
        )
        evaluation.failed_requests = sum(
            result.status == "failed" for result in evaluation.results
        )
        evaluation.status = "failed"
        evaluation.failure_message = message
        evaluation.completed_at = now
