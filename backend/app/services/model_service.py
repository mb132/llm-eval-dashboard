"""Persistence operations for configured models."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import ModelConfiguration
from ..schemas.models import (
    ModelConfigurationCreate,
    ModelConfigurationResponse,
    ModelConfigurationUpdate,
)
from ..schemas.providers import credential_requirement
from . import provider_service


async def list_models(session: AsyncSession) -> list[ModelConfiguration]:
    """Return configured models in stable creation order."""
    statement = (
        select(ModelConfiguration)
        .options(selectinload(ModelConfiguration.provider))
        .order_by(ModelConfiguration.id)
    )
    return list(await session.scalars(statement))


async def get_model(session: AsyncSession, model_id: int) -> ModelConfiguration | None:
    """Return one configured model, if present."""
    return await session.scalar(
        select(ModelConfiguration)
        .options(selectinload(ModelConfiguration.provider))
        .where(ModelConfiguration.id == model_id)
    )


async def create_model(
    session: AsyncSession, payload: ModelConfigurationCreate
) -> ModelConfiguration | None:
    """Persist a new model configuration."""
    if await provider_service.get_provider(session, payload.provider_id) is None:
        return None
    model = ModelConfiguration(**payload.model_dump())
    session.add(model)
    await session.commit()
    return await get_model(session, model.id)


async def update_model(
    session: AsyncSession,
    model: ModelConfiguration,
    payload: ModelConfigurationUpdate,
) -> ModelConfiguration | None:
    """Apply only fields explicitly included in a patch request."""
    changes = payload.model_dump(exclude_unset=True)
    if (
        "provider_id" in changes
        and await provider_service.get_provider(session, changes["provider_id"]) is None
    ):
        return None
    for field, value in changes.items():
        setattr(model, field, value)
    await session.commit()
    return await get_model(session, model.id)


async def delete_model(session: AsyncSession, model: ModelConfiguration) -> None:
    """Delete a model configuration."""
    await session.delete(model)
    await session.commit()


def unavailable_reason(model: ModelConfiguration) -> str | None:
    """Return why a model cannot safely be executed, if applicable."""
    provider = model.provider
    if provider.kind == "custom":
        return "Custom endpoints do not define an executable protocol."
    if (
        credential_requirement(provider.kind) == "required"
        and not provider.api_key_ciphertext
    ):
        return "Provider API key is not configured."
    return None


def to_response(model: ModelConfiguration) -> ModelConfigurationResponse:
    """Build a response without ever resolving or returning a credential value."""
    provider = model.provider
    reason = unavailable_reason(model)
    return ModelConfigurationResponse(
        id=model.id,
        display_name=model.display_name,
        provider=provider_service.to_summary(provider),
        model_name=model.model_name,
        parameters=model.parameters,
        active=model.active,
        runnable=model.active and reason is None,
        unavailable_reason=reason,
        created_at=model.created_at,
    )
