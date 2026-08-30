"""CRUD endpoints for reusable provider connections."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..schemas.providers import (
    ProviderConfigurationCreate,
    ProviderConfigurationResponse,
    ProviderConfigurationUpdate,
)
from ..services import provider_service

router = APIRouter(prefix="/api/providers", tags=["providers"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[ProviderConfigurationResponse])
async def list_provider_configurations(session: SessionDependency):
    return [
        provider_service.to_response(item)
        for item in await provider_service.list_providers(session)
    ]


@router.post(
    "",
    response_model=ProviderConfigurationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_provider_configuration(
    payload: ProviderConfigurationCreate, session: SessionDependency
):
    try:
        provider = await provider_service.create_provider(session, payload)
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="A provider with that name already exists."
        ) from exc
    return provider_service.to_response(provider)


@router.get("/{provider_id}", response_model=ProviderConfigurationResponse)
async def get_provider_configuration(provider_id: int, session: SessionDependency):
    return provider_service.to_response(
        await _get_provider_or_404(session, provider_id)
    )


@router.patch("/{provider_id}", response_model=ProviderConfigurationResponse)
async def update_provider_configuration(
    provider_id: int, payload: ProviderConfigurationUpdate, session: SessionDependency
):
    provider = await _get_provider_or_404(session, provider_id)
    try:
        updated = await provider_service.update_provider(session, provider, payload)
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=409, detail="A provider with that name already exists."
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return provider_service.to_response(updated)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider_configuration(provider_id: int, session: SessionDependency):
    provider = await _get_provider_or_404(session, provider_id)
    if not await provider_service.delete_provider(session, provider):
        raise HTTPException(
            status_code=409, detail="Delete or move the linked models first."
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _get_provider_or_404(session: AsyncSession, provider_id: int):
    provider = await provider_service.get_provider(session, provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="Provider configuration not found.")
    return provider
