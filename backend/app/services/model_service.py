"""Straightforward persistence operations for configured models."""

import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ModelConfiguration
from ..schemas.models import (
    ModelConfigurationCreate,
    ModelConfigurationResponse,
    ModelConfigurationUpdate,
    validate_provider_settings,
)


async def list_models(session: AsyncSession) -> list[ModelConfiguration]:
    """Return configured models in stable creation order."""
    statement = select(ModelConfiguration).order_by(ModelConfiguration.id)
    return list(await session.scalars(statement))


async def get_model(session: AsyncSession, model_id: int) -> ModelConfiguration | None:
    """Return one configured model, if present."""
    return await session.get(ModelConfiguration, model_id)


async def create_model(
    session: AsyncSession, payload: ModelConfigurationCreate
) -> ModelConfiguration:
    """Persist a new model configuration."""
    model = ModelConfiguration(**payload.model_dump())
    session.add(model)
    await session.commit()
    await session.refresh(model)
    return model


async def update_model(
    session: AsyncSession,
    model: ModelConfiguration,
    payload: ModelConfigurationUpdate,
) -> ModelConfiguration:
    """Apply only fields explicitly included in a patch request."""
    changes = payload.model_dump(exclude_unset=True)
    provider = changes.get("provider", model.provider)
    base_url = changes.get("base_url", model.base_url)
    api_key_env_var = changes.get("api_key_env_var", model.api_key_env_var)
    validate_provider_settings(provider, base_url, api_key_env_var)
    for field, value in changes.items():
        setattr(model, field, value)
    await session.commit()
    await session.refresh(model)
    return model


async def delete_model(session: AsyncSession, model: ModelConfiguration) -> None:
    """Delete a model configuration."""
    await session.delete(model)
    await session.commit()


def to_response(model: ModelConfiguration) -> ModelConfigurationResponse:
    """Build a response without ever resolving or returning a credential value."""
    credential_name = model.api_key_env_var
    return ModelConfigurationResponse(
        id=model.id,
        display_name=model.display_name,
        provider=model.provider,
        model_name=model.model_name,
        base_url=model.base_url,
        api_key_env_var=credential_name,
        has_credentials=bool(credential_name and os.getenv(credential_name)),
        parameters=model.parameters,
        active=model.active,
        created_at=model.created_at,
    )
