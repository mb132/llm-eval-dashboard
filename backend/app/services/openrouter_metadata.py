"""Bounded OpenRouter catalog and account metadata access."""

import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from time import monotonic
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ModelConfiguration, ProviderConfiguration
from ..models.base import utc_now
from ..services.credentials import CredentialConfigurationError, decrypt_api_key
from .pricing import usd_per_million_to_micro

OPENROUTER_ORIGIN = "https://openrouter.ai/api/v1"
CATALOG_TTL_SECONDS = 3600
FAILURE_TTL_SECONDS = 60
LIMITS_TTL_SECONDS = 60
MAX_METADATA_BYTES = 8_000_000


@dataclass(frozen=True)
class _CacheEntry:
    expires_at: float
    value: Any
    fetched_at: datetime | None = None


_catalog_cache: dict[int, _CacheEntry] = {}
_limits_cache: dict[int, _CacheEntry] = {}
_failed_catalog_until: dict[int, float] = {}
_failed_limits_until: dict[int, float] = {}
_locks: dict[tuple[str, int], asyncio.Lock] = {}


def invalidate_provider_metadata(provider_id: int) -> None:
    """Drop cached catalog and account data after credentials or endpoint edits."""
    _catalog_cache.pop(provider_id, None)
    _limits_cache.pop(provider_id, None)
    _failed_catalog_until.pop(provider_id, None)
    _failed_limits_until.pop(provider_id, None)


class MetadataUnavailable(RuntimeError):
    """Safe error when OpenRouter metadata cannot be fetched."""


def metadata_supported(provider: ProviderConfiguration) -> bool:
    return provider.kind == "openrouter" and provider.base_url is None


def _credential(provider: ProviderConfiguration) -> str:
    if not provider.api_key_ciphertext:
        raise MetadataUnavailable("OpenRouter API key is not configured.")
    try:
        return decrypt_api_key(
            provider.api_key_ciphertext,
            provider_id=provider.id,
            provider_kind=provider.kind,
        )
    except CredentialConfigurationError as exc:
        raise MetadataUnavailable("OpenRouter API key is unavailable.") from exc


async def _json_request(provider: ProviderConfiguration, path: str) -> dict[str, Any]:
    key = _credential(provider)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            async with client.stream(
                "GET",
                f"{OPENROUTER_ORIGIN}{path}",
                headers={"Authorization": f"Bearer {key}"},
            ) as response:
                if response.status_code != 200:
                    raise MetadataUnavailable("OpenRouter metadata request failed.")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_METADATA_BYTES:
                        raise MetadataUnavailable("OpenRouter metadata is too large.")
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise ValueError
        return parsed
    except MetadataUnavailable:
        raise
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        raise MetadataUnavailable(
            "OpenRouter metadata is temporarily unavailable."
        ) from exc


def _lock(kind: str, provider_id: int) -> asyncio.Lock:
    return _locks.setdefault((kind, provider_id), asyncio.Lock())


def _parse_catalog(payload: dict[str, Any]) -> dict[str, tuple[int, int]]:
    rows = payload.get("data")
    if not isinstance(rows, list):
        raise MetadataUnavailable("OpenRouter returned an invalid model catalog.")
    result: dict[str, tuple[int, int]] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            continue
        pricing = row.get("pricing")
        if not isinstance(pricing, dict):
            continue
        try:
            prompt = Decimal(str(pricing["prompt"])) * Decimal(1_000_000)
            completion = Decimal(str(pricing["completion"])) * Decimal(1_000_000)
            if not prompt.is_finite() or not completion.is_finite():
                continue
            result[row["id"]] = (
                usd_per_million_to_micro(prompt),
                usd_per_million_to_micro(completion),
            )
        except (KeyError, InvalidOperation, ValueError, TypeError):
            continue
    return result


async def fetch_catalog(
    provider: ProviderConfiguration, *, force: bool = False
) -> dict[str, tuple[int, int]]:
    if not metadata_supported(provider):
        raise MetadataUnavailable(
            "Automatic metadata requires the official OpenRouter endpoint."
        )
    if (
        not force
        and (entry := _catalog_cache.get(provider.id))
        and entry.expires_at > monotonic()
    ):
        return entry.value
    if not force and _failed_catalog_until.get(provider.id, 0) > monotonic():
        raise MetadataUnavailable("OpenRouter catalog refresh is temporarily paused.")
    async with _lock("catalog", provider.id):
        if (
            not force
            and (entry := _catalog_cache.get(provider.id))
            and entry.expires_at > monotonic()
        ):
            return entry.value
        if not force and _failed_catalog_until.get(provider.id, 0) > monotonic():
            raise MetadataUnavailable(
                "OpenRouter catalog refresh is temporarily paused."
            )
        try:
            value = _parse_catalog(await _json_request(provider, "/models"))
        except MetadataUnavailable:
            _failed_catalog_until[provider.id] = monotonic() + FAILURE_TTL_SECONDS
            raise
        _catalog_cache[provider.id] = _CacheEntry(
            monotonic() + CATALOG_TTL_SECONDS, value, utc_now()
        )
        _failed_catalog_until.pop(provider.id, None)
        return value


async def refresh_provider_prices(
    session: AsyncSession, provider: ProviderConfiguration, *, force: bool = False
) -> tuple[int, str | None]:
    models = list(
        await session.scalars(
            select(ModelConfiguration).where(
                ModelConfiguration.provider_id == provider.id,
                ModelConfiguration.pricing_mode == "automatic",
            )
        )
    )
    if not models:
        return 0, None
    try:
        catalog = await fetch_catalog(provider, force=force)
    except MetadataUnavailable as exc:
        return 0, str(exc)
    now = _catalog_cache[provider.id].fetched_at or utc_now()
    for model in models:
        rates = catalog.get(model.model_name)
        model.pricing_fetched_at = now
        model.pricing_source = "openrouter" if rates else None
        model.pricing_source_url = "https://openrouter.ai/models"
        model.pricing_currency = "USD" if rates else None
        model.pricing_effective_date = now.date() if rates else None
        model.input_price_micro_usd_per_million = rates[0] if rates else None
        model.output_price_micro_usd_per_million = rates[1] if rates else None
    await session.commit()
    return len(models), None


async def refresh_model_price(
    session: AsyncSession, model: ModelConfiguration, *, force: bool = False
) -> None:
    if model.pricing_mode != "automatic" or not metadata_supported(model.provider):
        return
    try:
        catalog = await fetch_catalog(model.provider, force=force)
    except MetadataUnavailable:
        return
    rates = catalog.get(model.model_name)
    now = _catalog_cache[model.provider.id].fetched_at or utc_now()
    model.pricing_fetched_at = now
    model.pricing_source = "openrouter" if rates else None
    model.pricing_source_url = "https://openrouter.ai/models"
    model.pricing_currency = "USD" if rates else None
    model.pricing_effective_date = now.date() if rates else None
    model.input_price_micro_usd_per_million = rates[0] if rates else None
    model.output_price_micro_usd_per_million = rates[1] if rates else None
    await session.commit()


async def get_account_limits(
    provider: ProviderConfiguration, *, force: bool = False
) -> dict[str, Any]:
    if not metadata_supported(provider):
        return {"available": False, "supported": False, "fetched_at": None}
    key_fingerprint = hashlib.sha256(
        (provider.api_key_ciphertext or "").encode()
    ).hexdigest()
    entry = _limits_cache.get(provider.id)
    if (
        not force
        and entry
        and entry.expires_at > monotonic()
        and entry.value["key"] == key_fingerprint
    ):
        return dict(entry.value["data"])
    if not force and _failed_limits_until.get(provider.id, 0) > monotonic():
        return {"available": False, "supported": True, "fetched_at": None}
    async with _lock("limits", provider.id):
        cached = _limits_cache.get(provider.id)
        if (
            not force
            and cached is not None
            and cached.expires_at > monotonic()
            and cached.value["key"] == key_fingerprint
        ):
            return dict(cached.value["data"])
        if not force and _failed_limits_until.get(provider.id, 0) > monotonic():
            return {"available": False, "supported": True, "fetched_at": None}
        try:
            payload = await _json_request(provider, "/key")
            data = payload.get("data", {})
            free = (
                data.get("free_model_daily_requests")
                if isinstance(data, dict)
                else None
            )
            result = {
                "available": isinstance(data, dict),
                "supported": True,
                "free_model_daily_requests": free if isinstance(free, dict) else None,
                "limit_remaining_usd": data.get("limit_remaining")
                if isinstance(data, dict)
                else None,
                "fetched_at": utc_now(),
            }
            _limits_cache[provider.id] = _CacheEntry(
                monotonic() + LIMITS_TTL_SECONDS,
                {"key": key_fingerprint, "data": result},
            )
            _failed_limits_until.pop(provider.id, None)
            return result
        except MetadataUnavailable:
            _failed_limits_until[provider.id] = monotonic() + FAILURE_TTL_SECONDS
            return {"available": False, "supported": True, "fetched_at": None}
