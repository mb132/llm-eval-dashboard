"""Exact-match model pricing and deterministic cost arithmetic."""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

MICRO_USD_PER_USD = 1_000_000
MAX_USD_PER_MILLION_TOKENS = Decimal("1000")
OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/models"
ANTHROPIC_PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing"
GEMINI_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing"


def usd_per_million_to_micro(value: Decimal) -> int:
    """Convert a bounded USD rate to an exact integer storage unit."""
    if value < 0 or value > MAX_USD_PER_MILLION_TOKENS:
        raise ValueError("price must be between 0 and 1000 USD per million tokens")
    scaled = value * MICRO_USD_PER_USD
    if scaled != scaled.to_integral_value():
        raise ValueError("price supports at most 6 decimal places")
    return int(scaled)


@dataclass(frozen=True)
class CatalogPrice:
    provider: str
    model_name: str
    input_micro_usd_per_million: int
    output_micro_usd_per_million: int
    effective_date: date
    source_url: str
    valid_until: date | None = None


def _price(
    provider: str,
    model_name: str,
    input_usd: str,
    output_usd: str,
    effective_date: str,
    source_url: str,
    *,
    valid_until: str | None = None,
) -> CatalogPrice:
    return CatalogPrice(
        provider=provider,
        model_name=model_name,
        input_micro_usd_per_million=usd_per_million_to_micro(Decimal(input_usd)),
        output_micro_usd_per_million=usd_per_million_to_micro(Decimal(output_usd)),
        effective_date=date.fromisoformat(effective_date),
        source_url=source_url,
        valid_until=date.fromisoformat(valid_until) if valid_until else None,
    )


CATALOG_PRICES = (
    _price("openai", "gpt-5.6-sol", "4", "20", "2026-08-31", OPENAI_PRICING_URL),
    _price("openai", "gpt-5.6", "4", "20", "2026-08-31", OPENAI_PRICING_URL),
    _price("openai", "gpt-5.6-terra", "2", "12", "2026-08-31", OPENAI_PRICING_URL),
    _price("openai", "gpt-5.6-luna", "0.2", "1.2", "2026-08-31", OPENAI_PRICING_URL),
    _price(
        "anthropic", "claude-fable-5", "10", "50", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-mythos-5", "10", "50", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-opus-5", "5", "25", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-opus-4-8", "5", "25", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-opus-4-7", "5", "25", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-opus-4-6", "5", "25", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-opus-4-5", "5", "25", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-sonnet-5", "2", "10", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-sonnet-4-6", "3", "15", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-sonnet-4-5", "3", "15", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "anthropic", "claude-haiku-4-5", "1", "5", "2026-08-31", ANTHROPIC_PRICING_URL
    ),
    _price(
        "gemini",
        "gemini-3.7-flash",
        "0.75",
        "3.75",
        "2026-08-31",
        GEMINI_PRICING_URL,
        valid_until="2026-12-31",
    ),
    _price(
        "gemini",
        "gemini-3.7-flash",
        "1.5",
        "7.5",
        "2027-01-01",
        GEMINI_PRICING_URL,
    ),
    _price(
        "gemini",
        "gemini-3.6-flash",
        "0.75",
        "3.75",
        "2026-08-31",
        GEMINI_PRICING_URL,
        valid_until="2026-12-31",
    ),
    _price(
        "gemini",
        "gemini-3.6-flash",
        "1.5",
        "7.5",
        "2027-01-01",
        GEMINI_PRICING_URL,
    ),
)


def get_catalog_price(
    provider: str, model_name: str, *, on_date: date | None = None
) -> CatalogPrice | None:
    """Return an exact, currently effective catalog entry."""
    effective_on = on_date or date.today()
    matches = [
        item
        for item in CATALOG_PRICES
        if item.provider == provider
        and item.model_name == model_name
        and item.effective_date <= effective_on
        and (item.valid_until is None or effective_on <= item.valid_until)
    ]
    return max(matches, key=lambda item: item.effective_date) if matches else None


def micro_to_usd_string(value: int) -> str:
    return format(Decimal(value) / MICRO_USD_PER_USD, ".6f")


def nano_to_usd_string(value: int) -> str:
    return format(Decimal(value) / 1_000_000_000, ".9f")


def calculate_cost_nano_usd(
    input_tokens: int | None,
    output_tokens: int | None,
    input_price_micro_usd_per_million: int | None,
    output_price_micro_usd_per_million: int | None,
) -> int | None:
    """Calculate request cost; missing usage or pricing stays unavailable."""
    if None in (
        input_tokens,
        output_tokens,
        input_price_micro_usd_per_million,
        output_price_micro_usd_per_million,
    ):
        return None
    assert input_tokens is not None
    assert output_tokens is not None
    assert input_price_micro_usd_per_million is not None
    assert output_price_micro_usd_per_million is not None
    nano_usd = Decimal(
        input_tokens * input_price_micro_usd_per_million
        + output_tokens * output_price_micro_usd_per_million
    ) / Decimal(1000)
    return int(nano_usd.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
