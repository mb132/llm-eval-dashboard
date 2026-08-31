"""Persistence operations for configured models."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import ModelConfiguration
from ..schemas.models import (
    ModelConfigurationCreate,
    ModelConfigurationResponse,
    ModelConfigurationUpdate,
    ModelPricingResponse,
    PricingSelection,
)
from ..schemas.providers import credential_requirement
from . import provider_service
from .pricing import (
    get_catalog_price,
    micro_to_usd_string,
    usd_per_million_to_micro,
)


def _clear_pricing(model: ModelConfiguration) -> None:
    model.input_price_micro_usd_per_million = None
    model.output_price_micro_usd_per_million = None
    model.pricing_currency = None
    model.pricing_source = None
    model.pricing_effective_date = None
    model.pricing_source_url = None


def _apply_pricing(
    model: ModelConfiguration,
    *,
    provider_kind: str,
    model_name: str,
    selection: PricingSelection,
) -> None:
    """Resolve catalog pricing or persist one explicit manual rate pair."""
    if selection.mode == "unavailable":
        _clear_pricing(model)
        return
    if selection.mode == "catalog":
        price = get_catalog_price(provider_kind, model_name)
        if price is None:
            _clear_pricing(model)
            return
        model.input_price_micro_usd_per_million = price.input_micro_usd_per_million
        model.output_price_micro_usd_per_million = price.output_micro_usd_per_million
        model.pricing_source = "catalog"
        model.pricing_effective_date = price.effective_date
        model.pricing_source_url = price.source_url
    else:
        assert selection.input_usd_per_million_tokens is not None
        assert selection.output_usd_per_million_tokens is not None
        model.input_price_micro_usd_per_million = usd_per_million_to_micro(
            selection.input_usd_per_million_tokens
        )
        model.output_price_micro_usd_per_million = usd_per_million_to_micro(
            selection.output_usd_per_million_tokens
        )
        model.pricing_source = "manual"
        model.pricing_effective_date = date.today()
        model.pricing_source_url = None
    model.pricing_currency = "USD"


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
    provider = await provider_service.get_provider(session, payload.provider_id)
    if provider is None:
        return None
    model = ModelConfiguration(**payload.model_dump(exclude={"pricing"}))
    _apply_pricing(
        model,
        provider_kind=provider.kind,
        model_name=model.model_name,
        selection=payload.pricing,
    )
    session.add(model)
    await session.commit()
    return await get_model(session, model.id)


async def update_model(
    session: AsyncSession,
    model: ModelConfiguration,
    payload: ModelConfigurationUpdate,
) -> ModelConfiguration | None:
    """Apply only fields explicitly included in a patch request."""
    changes = payload.model_dump(exclude_unset=True, exclude={"pricing"})
    provider = model.provider
    if "provider_id" in changes:
        provider = await provider_service.get_provider(session, changes["provider_id"])
    if provider is None:
        return None
    for field, value in changes.items():
        setattr(model, field, value)
    identity_changed = "provider_id" in changes or "model_name" in changes
    if payload.pricing is not None or identity_changed:
        _apply_pricing(
            model,
            provider_kind=provider.kind,
            model_name=model.model_name,
            selection=payload.pricing or PricingSelection(),
        )
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
    pricing = None
    if (
        model.input_price_micro_usd_per_million is not None
        and model.output_price_micro_usd_per_million is not None
        and model.pricing_currency == "USD"
        and model.pricing_source in {"catalog", "manual"}
        and model.pricing_effective_date is not None
    ):
        pricing = ModelPricingResponse(
            input_usd_per_million_tokens=micro_to_usd_string(
                model.input_price_micro_usd_per_million
            ),
            output_usd_per_million_tokens=micro_to_usd_string(
                model.output_price_micro_usd_per_million
            ),
            currency="USD",
            source=model.pricing_source,
            effective_date=model.pricing_effective_date,
            source_url=model.pricing_source_url,
        )
    return ModelConfigurationResponse(
        id=model.id,
        display_name=model.display_name,
        provider=provider_service.to_summary(provider),
        model_name=model.model_name,
        parameters=model.parameters,
        active=model.active,
        runnable=model.active and reason is None,
        unavailable_reason=reason,
        pricing=pricing,
        created_at=model.created_at,
    )
