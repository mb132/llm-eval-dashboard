"""Add OpenRouter automatic prices, rate controls, and price snapshots."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014_openrouter_pricing_limits"
down_revision: str | None = "0013_add_system_prompts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

PRICING_COMPLETE_OPENROUTER = (
    "(input_price_micro_usd_per_million IS NULL AND "
    "output_price_micro_usd_per_million IS NULL AND "
    "pricing_currency IS NULL AND pricing_source IS NULL AND "
    "pricing_effective_date IS NULL) OR "
    "(input_price_micro_usd_per_million IS NOT NULL AND "
    "output_price_micro_usd_per_million IS NOT NULL AND "
    "pricing_currency = 'USD' AND "
    "pricing_source IN ('catalog', 'manual', 'openrouter') AND "
    "pricing_effective_date IS NOT NULL)"
)
PRICING_COMPLETE_LEGACY = (
    "(input_price_micro_usd_per_million IS NULL AND "
    "output_price_micro_usd_per_million IS NULL AND "
    "pricing_currency IS NULL AND pricing_source IS NULL AND "
    "pricing_effective_date IS NULL) OR "
    "(input_price_micro_usd_per_million IS NOT NULL AND "
    "output_price_micro_usd_per_million IS NOT NULL AND "
    "pricing_currency = 'USD' AND "
    "pricing_source IN ('catalog', 'manual') AND "
    "pricing_effective_date IS NOT NULL)"
)


def upgrade() -> None:
    with op.batch_alter_table("model_configurations") as batch:
        batch.drop_constraint(
            op.f("ck_model_configurations_pricing_complete"), type_="check"
        )
        batch.create_check_constraint(
            op.f("ck_model_configurations_pricing_complete"),
            PRICING_COMPLETE_OPENROUTER,
        )
        batch.add_column(sa.Column("pricing_mode", sa.String(20), nullable=True))
        batch.add_column(sa.Column("pricing_fetched_at", sa.DateTime(timezone=True)))
        batch.add_column(sa.Column("requests_per_minute", sa.Integer()))
        batch.add_column(sa.Column("max_concurrent_requests", sa.Integer()))
    op.execute(
        "UPDATE model_configurations SET pricing_mode = 'catalog' "
        "WHERE pricing_source = 'catalog'"
    )
    op.execute(
        "UPDATE model_configurations SET pricing_mode = 'manual' "
        "WHERE pricing_source = 'manual'"
    )
    op.execute(
        "UPDATE model_configurations SET pricing_mode = 'automatic' "
        "WHERE pricing_source IS NULL AND provider_id IN "
        "(SELECT id FROM provider_configurations WHERE kind = 'openrouter')"
    )
    op.execute(
        "UPDATE model_configurations SET pricing_mode = 'unavailable' "
        "WHERE pricing_mode IS NULL"
    )
    with op.batch_alter_table("model_configurations") as batch:
        batch.alter_column("pricing_mode", existing_type=sa.String(20), nullable=False)
        batch.create_check_constraint(
            op.f("ck_model_configurations_pricing_mode_valid"),
            "pricing_mode IN ('catalog', 'automatic', 'manual', 'unavailable')",
        )
        batch.create_check_constraint(
            op.f("ck_model_configurations_requests_per_minute_positive"),
            "requests_per_minute IS NULL OR requests_per_minute > 0",
        )
        batch.create_check_constraint(
            op.f("ck_model_configurations_max_concurrent_requests_positive"),
            "max_concurrent_requests IS NULL OR max_concurrent_requests > 0",
        )
    with op.batch_alter_table("evaluation_results") as batch:
        batch.drop_constraint(
            op.f("ck_evaluation_results_pricing_complete"), type_="check"
        )
        batch.create_check_constraint(
            op.f("ck_evaluation_results_pricing_complete"),
            PRICING_COMPLETE_OPENROUTER,
        )
        batch.add_column(sa.Column("pricing_fetched_at", sa.DateTime(timezone=True)))
        batch.add_column(
            sa.Column(
                "pricing_stale", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
        batch.add_column(sa.Column("requests_per_minute", sa.Integer()))
        batch.add_column(sa.Column("max_concurrent_requests", sa.Integer()))


def downgrade() -> None:
    with op.batch_alter_table("evaluation_results") as batch:
        batch.drop_column("max_concurrent_requests")
        batch.drop_column("requests_per_minute")
        batch.drop_column("pricing_stale")
        batch.drop_column("pricing_fetched_at")
    op.execute(
        "UPDATE model_configurations SET input_price_micro_usd_per_million = NULL, "
        "output_price_micro_usd_per_million = NULL, pricing_currency = NULL, "
        "pricing_source = NULL, pricing_effective_date = NULL "
        "WHERE pricing_source = 'openrouter'"
    )
    with op.batch_alter_table("model_configurations") as batch:
        batch.drop_constraint(
            op.f("ck_model_configurations_max_concurrent_requests_positive"),
            type_="check",
        )
        batch.drop_constraint(
            op.f("ck_model_configurations_requests_per_minute_positive"), type_="check"
        )
        batch.drop_constraint(
            op.f("ck_model_configurations_pricing_mode_valid"), type_="check"
        )
        batch.drop_constraint(
            op.f("ck_model_configurations_pricing_complete"), type_="check"
        )
        batch.create_check_constraint(
            op.f("ck_model_configurations_pricing_complete"),
            PRICING_COMPLETE_LEGACY,
        )
        batch.drop_column("max_concurrent_requests")
        batch.drop_column("requests_per_minute")
        batch.drop_column("pricing_fetched_at")
        batch.drop_column("pricing_mode")
