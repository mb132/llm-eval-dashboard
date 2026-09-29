from app.services.openrouter_metadata import _parse_catalog


def test_openrouter_catalog_prices_convert_from_per_token_to_per_million() -> None:
    catalog = _parse_catalog(
        {
            "data": [
                {
                    "id": "vendor/model",
                    "pricing": {"prompt": "0.00000125", "completion": "0.000004"},
                },
                {
                    "id": "vendor/free-model",
                    "pricing": {"prompt": "0", "completion": "0"},
                },
            ]
        }
    )

    assert catalog == {
        "vendor/model": (1_250_000, 4_000_000),
        "vendor/free-model": (0, 0),
    }


def test_openrouter_catalog_ignores_invalid_prices_without_marking_them_free() -> None:
    catalog = _parse_catalog(
        {
            "data": [
                {
                    "id": "vendor/invalid",
                    "pricing": {"prompt": "NaN", "completion": "-0.000001"},
                },
                {
                    "id": "vendor/unsupported",
                    "pricing": {"prompt": "0.002", "completion": "0.003"},
                },
            ]
        }
    )

    assert catalog == {}
