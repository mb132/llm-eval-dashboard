"""Add persisted model prices and immutable result cost snapshots.

Revision ID: 0009_add_model_pricing
Revises: 0008_create_provider_configurations
Create Date: 2026-08-31
"""

from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa

from alembic import op

revision: str = "0009_add_model_pricing"
down_revision: str | None = "0008_create_provider_configurations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MODEL_PRICES: dict[tuple[str, str], tuple[int, int, date, str]] = {
    ("openai", "gpt-5.6-sol"): (
        4_000_000,
        20_000_000,
        date(2026, 8, 31),
        "https://developers.openai.com/api/docs/models",
    ),
    ("openai", "gpt-5.6"): (
        4_000_000,
        20_000_000,
        date(2026, 8, 31),
        "https://developers.openai.com/api/docs/models",
    ),
    ("openai", "gpt-5.6-terra"): (
        2_000_000,
        12_000_000,
        date(2026, 8, 31),
        "https://developers.openai.com/api/docs/models",
    ),
    ("openai", "gpt-5.6-luna"): (
        200_000,
        1_200_000,
        date(2026, 8, 31),
        "https://developers.openai.com/api/docs/models",
    ),
    ("anthropic", "claude-fable-5"): (
        10_000_000,
        50_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-mythos-5"): (
        10_000_000,
        50_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-opus-5"): (
        5_000_000,
        25_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-opus-4-8"): (
        5_000_000,
        25_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-opus-4-7"): (
        5_000_000,
        25_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-opus-4-6"): (
        5_000_000,
        25_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-opus-4-5"): (
        5_000_000,
        25_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-sonnet-5"): (
        2_000_000,
        10_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-sonnet-4-6"): (
        3_000_000,
        15_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-sonnet-4-5"): (
        3_000_000,
        15_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("anthropic", "claude-haiku-4-5"): (
        1_000_000,
        5_000_000,
        date(2026, 8, 31),
        "https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    ("gemini", "gemini-3.7-flash"): (
        750_000,
        3_750_000,
        date(2026, 8, 31),
        "https://ai.google.dev/gemini-api/docs/pricing",
    ),
    ("gemini", "gemini-3.6-flash"): (
        750_000,
        3_750_000,
        date(2026, 8, 31),
        "https://ai.google.dev/gemini-api/docs/pricing",
    ),
}


def _add_pricing_columns(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch:
        batch.add_column(sa.Column("input_price_micro_usd_per_million", sa.Integer()))
        batch.add_column(sa.Column("output_price_micro_usd_per_million", sa.Integer()))
        batch.add_column(sa.Column("pricing_currency", sa.String(length=3)))
        batch.add_column(sa.Column("pricing_source", sa.String(length=20)))
        batch.add_column(sa.Column("pricing_effective_date", sa.Date()))
        batch.add_column(sa.Column("pricing_source_url", sa.String(length=2000)))


def _drop_pricing_columns(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch:
        batch.drop_column("pricing_source_url")
        batch.drop_column("pricing_effective_date")
        batch.drop_column("pricing_source")
        batch.drop_column("pricing_currency")
        batch.drop_column("output_price_micro_usd_per_million")
        batch.drop_column("input_price_micro_usd_per_million")


def upgrade() -> None:
    _add_pricing_columns("model_configurations")
    _add_pricing_columns("evaluation_results")
    with op.batch_alter_table("evaluation_results") as batch:
        batch.add_column(sa.Column("estimated_cost_nano_usd", sa.Integer()))

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT model_configurations.id, provider_configurations.kind, "
            "model_configurations.model_name FROM model_configurations "
            "JOIN provider_configurations ON provider_configurations.id = "
            "model_configurations.provider_id"
        )
    ).mappings()
    for row in rows:
        price = MODEL_PRICES.get((row["kind"], row["model_name"]))
        if price is None:
            continue
        input_price, output_price, effective_date, source_url = price
        connection.execute(
            sa.text(
                "UPDATE model_configurations SET "
                "input_price_micro_usd_per_million = :input_price, "
                "output_price_micro_usd_per_million = :output_price, "
                "pricing_currency = 'USD', pricing_source = 'catalog', "
                "pricing_effective_date = :effective_date, "
                "pricing_source_url = :source_url WHERE id = :id"
            ),
            {
                "id": row["id"],
                "input_price": input_price,
                "output_price": output_price,
                "effective_date": effective_date,
                "source_url": source_url,
            },
        )

    with op.batch_alter_table("model_configurations") as batch:
        batch.create_check_constraint(
            "pricing_complete",
            "(input_price_micro_usd_per_million IS NULL AND "
            "output_price_micro_usd_per_million IS NULL AND "
            "pricing_currency IS NULL AND pricing_source IS NULL AND "
            "pricing_effective_date IS NULL) OR "
            "(input_price_micro_usd_per_million IS NOT NULL AND "
            "output_price_micro_usd_per_million IS NOT NULL AND "
            "pricing_currency = 'USD' AND "
            "pricing_source IN ('catalog', 'manual') AND "
            "pricing_effective_date IS NOT NULL)",
        )
        batch.create_check_constraint(
            "input_price_bounded",
            "input_price_micro_usd_per_million IS NULL OR "
            "input_price_micro_usd_per_million BETWEEN 0 AND 1000000000",
        )
        batch.create_check_constraint(
            "output_price_bounded",
            "output_price_micro_usd_per_million IS NULL OR "
            "output_price_micro_usd_per_million BETWEEN 0 AND 1000000000",
        )
    with op.batch_alter_table("evaluation_results") as batch:
        batch.create_check_constraint(
            "pricing_complete",
            "(input_price_micro_usd_per_million IS NULL AND "
            "output_price_micro_usd_per_million IS NULL AND "
            "pricing_currency IS NULL AND pricing_source IS NULL AND "
            "pricing_effective_date IS NULL) OR "
            "(input_price_micro_usd_per_million IS NOT NULL AND "
            "output_price_micro_usd_per_million IS NOT NULL AND "
            "pricing_currency = 'USD' AND "
            "pricing_source IN ('catalog', 'manual') AND "
            "pricing_effective_date IS NOT NULL)",
        )
        batch.create_check_constraint(
            "estimated_cost_nonnegative",
            "estimated_cost_nano_usd IS NULL OR estimated_cost_nano_usd >= 0",
        )
        batch.create_check_constraint(
            "input_price_bounded",
            "input_price_micro_usd_per_million IS NULL OR "
            "input_price_micro_usd_per_million BETWEEN 0 AND 1000000000",
        )
        batch.create_check_constraint(
            "output_price_bounded",
            "output_price_micro_usd_per_million IS NULL OR "
            "output_price_micro_usd_per_million BETWEEN 0 AND 1000000000",
        )


def downgrade() -> None:
    with op.batch_alter_table("evaluation_results") as batch:
        batch.drop_constraint(op.f("ck_evaluation_results_pricing_complete"))
        batch.drop_constraint(op.f("ck_evaluation_results_estimated_cost_nonnegative"))
        batch.drop_constraint(op.f("ck_evaluation_results_input_price_bounded"))
        batch.drop_constraint(op.f("ck_evaluation_results_output_price_bounded"))
        batch.drop_column("estimated_cost_nano_usd")
    _drop_pricing_columns("evaluation_results")
    with op.batch_alter_table("model_configurations") as batch:
        batch.drop_constraint(op.f("ck_model_configurations_pricing_complete"))
        batch.drop_constraint(op.f("ck_model_configurations_input_price_bounded"))
        batch.drop_constraint(op.f("ck_model_configurations_output_price_bounded"))
    _drop_pricing_columns("model_configurations")
