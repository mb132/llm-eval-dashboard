"""Prompt-management rules and persistence operations."""

import re
import unicodedata
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import Prompt, PromptVersion
from ..models.base import utc_now

MAX_NAME_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 500
MAX_CONTENT_LENGTH = 20_000
MAX_SYSTEM_PROMPT_LENGTH = 20_000
INPUT_PLACEHOLDER = "{{input}}"
PLACEHOLDER_PATTERN = re.compile(r"{{[^{}]*}}")


class PromptNotFoundError(LookupError):
    """Raised when a requested prompt does not exist."""


class PromptConflictError(RuntimeError):
    """Raised when prompt uniqueness would be violated."""


class PromptValidationError(ValueError):
    """Raised when normalized prompt data violates a domain rule."""


def normalize_prompt_name(value: str) -> tuple[str, str]:
    """Return a clean display name and its case-insensitive uniqueness key."""
    display_name = " ".join(unicodedata.normalize("NFKC", value).split())
    if not display_name:
        raise PromptValidationError("Prompt name must not be empty.")
    if len(display_name) > MAX_NAME_LENGTH:
        raise PromptValidationError(
            f"Prompt name must contain at most {MAX_NAME_LENGTH} characters."
        )
    name_key = display_name.casefold()
    if len(name_key) > MAX_NAME_LENGTH:
        raise PromptValidationError(
            "Prompt name is too long after Unicode normalization."
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
        raise PromptValidationError(
            f"Description must contain at most {MAX_DESCRIPTION_LENGTH} characters."
        )
    return description


def validate_system_prompt(system_prompt: str | None) -> str | None:
    """Normalize and validate optional static system instructions."""
    if system_prompt is None or not system_prompt.strip():
        return None
    if len(system_prompt) > MAX_SYSTEM_PROMPT_LENGTH:
        raise PromptValidationError(
            "System prompt must contain at most "
            f"{MAX_SYSTEM_PROMPT_LENGTH} characters."
        )
    if PLACEHOLDER_PATTERN.search(system_prompt):
        raise PromptValidationError("System prompt must not contain placeholders.")
    return system_prompt


def validate_prompt_content(content: str) -> str:
    """Validate the single-placeholder prompt template without rewriting it."""
    if not content.strip():
        raise PromptValidationError("Prompt content must not be empty.")
    if len(content) > MAX_CONTENT_LENGTH:
        raise PromptValidationError(
            f"Prompt content must contain at most {MAX_CONTENT_LENGTH} characters."
        )

    placeholders = PLACEHOLDER_PATTERN.findall(content)
    if placeholders != [INPUT_PLACEHOLDER]:
        raise PromptValidationError(
            "Prompt content must include {{input}} exactly once and no other "
            "placeholders."
        )
    return content


async def create_prompt(
    session: AsyncSession,
    *,
    name: str,
    description: str | None,
    system_prompt: str | None = None,
    content: str,
) -> Prompt:
    """Create a prompt and its first immutable version atomically."""
    display_name, name_key = normalize_prompt_name(name)
    clean_description = normalize_description(description)
    validated_content = validate_prompt_content(content)
    validated_system_prompt = validate_system_prompt(system_prompt)

    prompt = Prompt(
        name=display_name,
        name_key=name_key,
        description=clean_description,
    )
    prompt.versions.append(
        PromptVersion(
            version_number=1,
            system_prompt=validated_system_prompt,
            content=validated_content,
        )
    )

    try:
        async with session.begin():
            session.add(prompt)
    except IntegrityError as exc:
        raise PromptConflictError("A prompt with this name already exists.") from exc
    return prompt


async def list_prompts(session: AsyncSession) -> list[tuple[Prompt, int]]:
    """List prompts with their latest version number, newest first."""
    latest_versions = (
        select(
            PromptVersion.prompt_id,
            func.max(PromptVersion.version_number).label("latest_version_number"),
        )
        .group_by(PromptVersion.prompt_id)
        .subquery()
    )
    statement = (
        select(Prompt, latest_versions.c.latest_version_number)
        .join(latest_versions, latest_versions.c.prompt_id == Prompt.id)
        .order_by(Prompt.updated_at.desc(), Prompt.name.asc())
    )
    rows = (await session.execute(statement)).all()
    return [(prompt, version_number) for prompt, version_number in rows]


async def get_prompt(session: AsyncSession, prompt_id: UUID) -> Prompt:
    """Return a prompt with all versions eagerly loaded."""
    statement = (
        select(Prompt)
        .where(Prompt.id == prompt_id)
        .options(selectinload(Prompt.versions))
    )
    prompt = (await session.scalars(statement)).one_or_none()
    if prompt is None:
        raise PromptNotFoundError("Prompt not found.")
    prompt.versions.sort(key=lambda version: version.version_number, reverse=True)
    return prompt


async def update_prompt(
    session: AsyncSession,
    prompt_id: UUID,
    updates: Mapping[str, Any],
) -> Prompt:
    """Update prompt metadata without changing its versioned content."""
    try:
        async with session.begin():
            prompt = await session.get(Prompt, prompt_id)
            if prompt is None:
                raise PromptNotFoundError("Prompt not found.")
            if "name" in updates:
                prompt.name, prompt.name_key = normalize_prompt_name(updates["name"])
            if "description" in updates:
                prompt.description = normalize_description(updates["description"])
            prompt.updated_at = utc_now()
    except IntegrityError as exc:
        raise PromptConflictError("A prompt with this name already exists.") from exc
    return await get_prompt(session, prompt_id)


async def create_prompt_version(
    session: AsyncSession,
    prompt_id: UUID,
    *,
    content: str,
    system_prompt: str | None = None,
) -> PromptVersion:
    """Append the next immutable version to a prompt."""
    validated_content = validate_prompt_content(content)
    validated_system_prompt = validate_system_prompt(system_prompt)
    try:
        async with session.begin():
            prompt = await session.get(Prompt, prompt_id)
            if prompt is None:
                raise PromptNotFoundError("Prompt not found.")
            latest_version = await session.scalar(
                select(func.max(PromptVersion.version_number)).where(
                    PromptVersion.prompt_id == prompt_id
                )
            )
            version = PromptVersion(
                prompt_id=prompt_id,
                version_number=(latest_version or 0) + 1,
                system_prompt=validated_system_prompt,
                content=validated_content,
            )
            session.add(version)
            prompt.updated_at = utc_now()
    except IntegrityError as exc:
        raise PromptConflictError(
            "A prompt version was created concurrently. Please retry."
        ) from exc
    return version
