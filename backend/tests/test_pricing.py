"""Unit coverage for exact catalog lookup and cost arithmetic."""

from datetime import date
from decimal import Decimal

import pytest
from app.services.pricing import (
    calculate_cost_nano_usd,
    get_catalog_price,
    micro_to_usd_string,
    nano_to_usd_string,
    usd_per_million_to_micro,
)


def test_catalog_requires_an_exact_current_model_match() -> None:
    assert get_catalog_price("openai", "gpt-5.6-sol") is not None
    assert get_catalog_price("openai", "gpt-5.6-sol-preview") is None
    assert get_catalog_price("ollama", "gpt-5.6-sol") is None
    future_price = get_catalog_price(
        "gemini", "gemini-3.7-flash", on_date=date(2027, 1, 1)
    )
    assert future_price is not None
    assert future_price.input_micro_usd_per_million == 1_500_000


def test_decimal_prices_round_trip_without_binary_float() -> None:
    stored = usd_per_million_to_micro(Decimal("0.123456"))

    assert stored == 123_456
    assert micro_to_usd_string(stored) == "0.123456"
    assert nano_to_usd_string(7_000_000) == "0.007000000"


@pytest.mark.parametrize("value", [Decimal("-0.1"), Decimal("1000.000001")])
def test_prices_are_bounded(value: Decimal) -> None:
    with pytest.raises(ValueError):
        usd_per_million_to_micro(value)


def test_cost_requires_complete_usage_and_pricing() -> None:
    assert calculate_cost_nano_usd(1000, 500, 2_000_000, 10_000_000) == 7_000_000
    assert calculate_cost_nano_usd(None, 500, 2_000_000, 10_000_000) is None
    assert calculate_cost_nano_usd(1000, 500, None, 10_000_000) is None
