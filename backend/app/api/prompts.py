"""REST API for persistent prompt and prompt-version management."""

from datetime import datetime
from typing import Annotated, NoReturn, Self
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..models import Prompt, PromptVersion
from ..services.prompts import (
    MAX_CONTENT_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_NAME_LENGTH,
    MAX_SYSTEM_PROMPT_LENGTH,
    PromptConflictError,
    PromptNotFoundError,
    PromptValidationError,
    create_prompt,
    create_prompt_version,
    get_prompt,
    list_prompts,
    update_prompt,
)

router = APIRouter(prefix="/api/prompts", tags=["prompts"])
DatabaseSession = Annotated[AsyncSession, Depends(get_session)]


class StrictRequest(BaseModel):
    """Reject request fields that are not part of the public contract."""

    model_config = ConfigDict(extra="forbid")


class PromptCreate(StrictRequest):
    """Payload for creating a prompt together with version one."""

    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)
    system_prompt: str | None = Field(
        default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH
    )
    content: str = Field(min_length=1, max_length=MAX_CONTENT_LENGTH)


class PromptUpdate(StrictRequest):
    """Editable prompt metadata; versioned content is intentionally excluded."""

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION_LENGTH)

    @model_validator(mode="after")
    def require_update(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one prompt field must be provided.")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Prompt name must not be null.")
        return self


class PromptVersionCreate(StrictRequest):
    """Payload for appending an immutable prompt version."""

    content: str = Field(min_length=1, max_length=MAX_CONTENT_LENGTH)
    system_prompt: str | None = Field(
        default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH
    )


class PromptVersionResponse(BaseModel):
    """Public representation of one immutable prompt version."""

    id: UUID
    prompt_id: UUID
    version_number: int
    system_prompt: str | None
    content: str
    created_at: datetime


class PromptSummaryResponse(BaseModel):
    """Compact prompt representation used by the list view."""

    id: UUID
    name: str
    description: str | None
    latest_version_number: int
    created_at: datetime
    updated_at: datetime


class PromptDetailResponse(BaseModel):
    """Prompt metadata together with its complete version history."""

    id: UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    versions: list[PromptVersionResponse]


def _version_response(version: PromptVersion) -> PromptVersionResponse:
    return PromptVersionResponse(
        id=version.id,
        prompt_id=version.prompt_id,
        version_number=version.version_number,
        system_prompt=version.system_prompt,
        content=version.content,
        created_at=version.created_at,
    )


def _detail_response(prompt: Prompt) -> PromptDetailResponse:
    return PromptDetailResponse(
        id=prompt.id,
        name=prompt.name,
        description=prompt.description,
        created_at=prompt.created_at,
        updated_at=prompt.updated_at,
        versions=[_version_response(version) for version in prompt.versions],
    )


def _raise_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, PromptNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, PromptConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, PromptValidationError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    raise exc


@router.get("", response_model=list[PromptSummaryResponse])
async def read_prompts(session: DatabaseSession) -> list[PromptSummaryResponse]:
    """List all prompts ordered by most recent activity."""
    prompts = await list_prompts(session)
    return [
        PromptSummaryResponse(
            id=prompt.id,
            name=prompt.name,
            description=prompt.description,
            latest_version_number=latest_version,
            created_at=prompt.created_at,
            updated_at=prompt.updated_at,
        )
        for prompt, latest_version in prompts
    ]


@router.post(
    "",
    response_model=PromptDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_prompt(
    payload: PromptCreate, session: DatabaseSession
) -> PromptDetailResponse:
    """Create a prompt and its first immutable version."""
    try:
        prompt = await create_prompt(session, **payload.model_dump())
    except (PromptConflictError, PromptValidationError) as exc:
        _raise_http_error(exc)
    return _detail_response(prompt)


@router.get("/{prompt_id}", response_model=PromptDetailResponse)
async def read_prompt(
    prompt_id: UUID, session: DatabaseSession
) -> PromptDetailResponse:
    """Return prompt metadata and all immutable versions."""
    try:
        prompt = await get_prompt(session, prompt_id)
    except PromptNotFoundError as exc:
        _raise_http_error(exc)
    return _detail_response(prompt)


@router.patch("/{prompt_id}", response_model=PromptDetailResponse)
async def edit_prompt(
    prompt_id: UUID,
    payload: PromptUpdate,
    session: DatabaseSession,
) -> PromptDetailResponse:
    """Update prompt metadata without mutating versioned content."""
    try:
        prompt = await update_prompt(
            session,
            prompt_id,
            payload.model_dump(exclude_unset=True),
        )
    except (PromptConflictError, PromptNotFoundError, PromptValidationError) as exc:
        _raise_http_error(exc)
    return _detail_response(prompt)


@router.post(
    "/{prompt_id}/versions",
    response_model=PromptVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_prompt_version(
    prompt_id: UUID,
    payload: PromptVersionCreate,
    session: DatabaseSession,
) -> PromptVersionResponse:
    """Append an immutable content version to an existing prompt."""
    try:
        version = await create_prompt_version(
            session,
            prompt_id,
            content=payload.content,
        )
    except (PromptConflictError, PromptNotFoundError, PromptValidationError) as exc:
        _raise_http_error(exc)
    return _version_response(version)
