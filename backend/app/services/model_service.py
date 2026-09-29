"""Persistence operations for configured models."""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from ..models import ModelConfiguration, ProviderConfiguration
from ..schemas.models import (
    ModelConfigurationCreate,
    ModelConfigurationResponse,
    ModelConfigurationUpdate,
    ModelPricingResponse,
    PricingSelection,
)
from ..schemas.providers import credential_requirement
from . import provider_service
from .openrouter_metadata import refresh_model_price
from .playground import configure_openrouter_model_limits
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
    model.pricing_fetched_at = None


def _apply_pricing(
    model: ModelConfiguration,
    *,
    provider_kind: str,
    model_name: str,
    selection: PricingSelection,
) -> None:
    """Resolve catalog pricing or persist one explicit manual rate pair."""
    if selection.mode == "unavailable":
        model.pricing_mode = "unavailable"
        _clear_pricing(model)
        return
    if selection.mode == "automatic":
        model.pricing_mode = "automatic"
        _clear_pricing(model)
        return
    if selection.mode == "catalog":
        model.pricing_mode = "catalog"
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
        model.pricing_mode = "manual"
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
    if (
        payload.requests_per_minute is not None
        or payload.max_concurrent_requests is not None
    ) and provider.kind != "openrouter":
        raise ValueError("Rate controls are only supported for OpenRouter models.")
    if payload.pricing.mode == "automatic" and provider.kind != "openrouter":
        raise ValueError("Automatic pricing is only supported for OpenRouter models.")
    model = ModelConfiguration(**payload.model_dump(exclude={"pricing"}))
    selection = payload.pricing
    if provider.kind == "openrouter" and selection.mode == "catalog":
        selection = PricingSelection(mode="automatic")
    _apply_pricing(
        model,
        provider_kind=provider.kind,
        model_name=model.model_name,
        selection=selection,
    )
    session.add(model)
    await session.commit()
    persisted = await get_model(session, model.id)
    if persisted is not None:
        await _configure_openrouter_limits(session, provider.id, persisted.model_name)
        await refresh_model_price(session, persisted)
        return await get_model(session, persisted.id)
    return None


async def update_model(
    session: AsyncSession,
    model: ModelConfiguration,
    payload: ModelConfigurationUpdate,
) -> ModelConfiguration | None:
    """Apply only fields explicitly included in a patch request."""
    changes = payload.model_dump(exclude_unset=True, exclude={"pricing"})
    provider = model.provider
    original_provider_id = model.provider_id
    original_model_name = model.model_name
    original_provider_kind = model.provider.kind
    identity_changed = (
        "provider_id" in changes and changes["provider_id"] != model.provider_id
    ) or ("model_name" in changes and changes["model_name"] != model.model_name)
    provider_changed = (
        "provider_id" in changes and changes["provider_id"] != model.provider_id
    )
    if provider_changed:
        provider = await provider_service.get_provider(session, changes["provider_id"])
    if provider is None:
        return None
    if (
        payload.pricing is not None
        and payload.pricing.mode == "automatic"
        and provider.kind != "openrouter"
    ):
        raise ValueError("Automatic pricing is only supported for OpenRouter models.")
    for field, value in changes.items():
        setattr(model, field, value)
    if provider_changed:
        model.provider = provider
        if provider.kind != "openrouter":
            model.requests_per_minute = None
            model.max_concurrent_requests = None
    if payload.pricing is not None or identity_changed:
        selection = payload.pricing or PricingSelection()
        if (
            identity_changed
            and payload.pricing is None
            and provider.kind == "openrouter"
        ):
            selection = PricingSelection(mode="automatic")
        _apply_pricing(
            model,
            provider_kind=provider.kind,
            model_name=model.model_name,
            selection=selection,
        )
    if "requests_per_minute" in changes or "max_concurrent_requests" in changes:
        if provider.kind != "openrouter":
            raise ValueError("Rate controls are only supported for OpenRouter models.")
    await session.commit()
    persisted = await get_model(session, model.id)
    if persisted is not None:
        controls_changed = (
            "requests_per_minute" in changes
            or "max_concurrent_requests" in changes
            or "active" in changes
        )
        if identity_changed or controls_changed:
            if original_provider_kind == "openrouter":
                await _configure_openrouter_limits(
                    session, original_provider_id, original_model_name
                )
            if provider.kind == "openrouter":
                await _configure_openrouter_limits(
                    session, provider.id, persisted.model_name
                )
    if persisted is not None and (identity_changed or payload.pricing is not None):
        await refresh_model_price(session, persisted)
        return await get_model(session, persisted.id)
    return persisted


async def delete_model(session: AsyncSession, model: ModelConfiguration) -> None:
    """Delete a model configuration."""
    provider_id, model_name, is_openrouter = (
        model.provider_id,
        model.model_name,
        model.provider.kind == "openrouter",
    )
    await session.delete(model)
    await session.commit()
    if is_openrouter:
        await _configure_openrouter_limits(session, provider_id, model_name)


async def _configure_openrouter_limits(
    session: AsyncSession, provider_id: int, model_name: str
) -> None:
    rows = list(
        await session.execute(
            select(
                ModelConfiguration.requests_per_minute,
                ModelConfiguration.max_concurrent_requests,
            ).where(
                ModelConfiguration.provider_id == provider_id,
                ModelConfiguration.model_name == model_name,
                ModelConfiguration.active.is_(True),
            )
        )
    )
    configure_openrouter_model_limits(
        provider_id,
        model_name,
        [
            row.requests_per_minute
            for row in rows
            if row.requests_per_minute is not None
        ],
        [
            row.max_concurrent_requests
            for row in rows
            if row.max_concurrent_requests is not None
        ],
    )


async def configure_active_openrouter_limits(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Initialize process-wide limits from all active OpenRouter configurations."""
    async with session_factory() as session:
        rows = list(
            await session.execute(
                select(
                    ModelConfiguration.provider_id,
                    ModelConfiguration.model_name,
                    ModelConfiguration.requests_per_minute,
                    ModelConfiguration.max_concurrent_requests,
                )
                .join(ProviderConfiguration)
                .where(
                    ModelConfiguration.active.is_(True),
                    ProviderConfiguration.kind == "openrouter",
                )
            )
        )
    groups: dict[tuple[int, str], list[tuple[int | None, int | None]]] = {}
    for row in rows:
        groups.setdefault((row.provider_id, row.model_name), []).append(
            (row.requests_per_minute, row.max_concurrent_requests)
        )
    for (provider_id, model_name), values in groups.items():
        configure_openrouter_model_limits(
            provider_id,
            model_name,
            [rpm for rpm, _ in values if rpm is not None],
            [limit for _, limit in values if limit is not None],
        )


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
        and model.pricing_source in {"catalog", "manual", "openrouter"}
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
            fetched_at=model.pricing_fetched_at,
            stale=(
                model.pricing_source == "openrouter"
                and model.pricing_fetched_at is not None
                and model.pricing_fetched_at < datetime.now(UTC) - timedelta(hours=1)
            ),
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
        pricing_mode=model.pricing_mode,
        pricing_fetched_at=model.pricing_fetched_at,
        requests_per_minute=model.requests_per_minute,
        max_concurrent_requests=model.max_concurrent_requests,
        created_at=model.created_at,
    )
