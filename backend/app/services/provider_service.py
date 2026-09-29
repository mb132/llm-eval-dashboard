"""Persistence and safe serialization for reusable provider connections."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import ModelConfiguration, ProviderConfiguration
from ..schemas.providers import (
    ProviderConfigurationCreate,
    ProviderConfigurationResponse,
    ProviderConfigurationUpdate,
    ProviderSummary,
    credential_requirement,
    validate_provider_settings,
)
from .credentials import encrypt_api_key
from .openrouter_metadata import invalidate_provider_metadata


async def list_providers(session: AsyncSession) -> list[ProviderConfiguration]:
    return list(
        await session.scalars(
            select(ProviderConfiguration)
            .options(selectinload(ProviderConfiguration.models))
            .order_by(ProviderConfiguration.id)
        )
    )


async def get_provider(
    session: AsyncSession, provider_id: int
) -> ProviderConfiguration | None:
    return await session.scalar(
        select(ProviderConfiguration)
        .options(selectinload(ProviderConfiguration.models))
        .where(ProviderConfiguration.id == provider_id)
    )


async def create_provider(
    session: AsyncSession, payload: ProviderConfigurationCreate
) -> ProviderConfiguration:
    provider = ProviderConfiguration(**payload.model_dump(exclude={"api_key"}))
    session.add(provider)
    await session.flush()
    if payload.api_key:
        provider.api_key_ciphertext = encrypt_api_key(
            payload.api_key, provider_id=provider.id, provider_kind=provider.kind
        )
    await session.commit()
    persisted = await get_provider(session, provider.id)
    if persisted is None:
        raise RuntimeError("Created provider could not be reloaded.")
    return persisted


async def update_provider(
    session: AsyncSession,
    provider: ProviderConfiguration,
    payload: ProviderConfigurationUpdate,
) -> ProviderConfiguration:
    changes = payload.model_dump(exclude_unset=True)
    base_url = changes.get("base_url", provider.base_url)
    effective_key = (
        changes.get("api_key")
        if "api_key" in changes
        else ("configured" if provider.api_key_ciphertext else None)
    )
    validate_provider_settings(provider.kind, base_url, effective_key)
    if "display_name" in changes:
        provider.display_name = changes["display_name"]
    if "base_url" in changes:
        provider.base_url = base_url
    if "api_key" in changes:
        provider.api_key_ciphertext = (
            encrypt_api_key(
                changes["api_key"], provider_id=provider.id, provider_kind=provider.kind
            )
            if changes["api_key"]
            else None
        )
    if "api_key" in changes or "base_url" in changes:
        invalidate_provider_metadata(provider.id)
    await session.commit()
    persisted = await get_provider(session, provider.id)
    if persisted is None:
        raise RuntimeError("Updated provider could not be reloaded.")
    return persisted


async def delete_provider(
    session: AsyncSession, provider: ProviderConfiguration
) -> bool:
    count = await session.scalar(
        select(func.count(ModelConfiguration.id)).where(
            ModelConfiguration.provider_id == provider.id
        )
    )
    if count:
        return False
    await session.delete(provider)
    await session.commit()
    return True


def to_summary(provider: ProviderConfiguration) -> ProviderSummary:
    return ProviderSummary(
        id=provider.id,
        display_name=provider.display_name,
        kind=provider.kind,
        base_url=provider.base_url,
        has_api_key=provider.api_key_ciphertext is not None,
        api_key_requirement=credential_requirement(provider.kind),
    )


def to_response(provider: ProviderConfiguration) -> ProviderConfigurationResponse:
    return ProviderConfigurationResponse(
        **to_summary(provider).model_dump(),
        model_count=len(provider.models),
        created_at=provider.created_at,
    )
