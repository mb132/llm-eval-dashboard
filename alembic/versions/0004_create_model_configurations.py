"""Create persisted model configurations.

Revision ID: 0004_create_model_configurations
Revises: 0003_create_evaluations
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_create_model_configurations"
down_revision: str | None = "0003_create_evaluations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create model configuration persistence without storing secret values."""
    op.create_table(
        "model_configurations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model_name", sa.String(length=300), nullable=False),
        sa.Column("base_url", sa.String(length=2000), nullable=True),
        sa.Column("api_key_env_var", sa.String(length=200), nullable=True),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_model_configurations")),
    )
    op.create_index(
        op.f("ix_model_configurations_active"),
        "model_configurations",
        ["active"],
        unique=False,
    )
    op.create_index(
        op.f("ix_model_configurations_display_name"),
        "model_configurations",
        ["display_name"],
        unique=False,
    )
    op.create_index(
        op.f("ix_model_configurations_provider"),
        "model_configurations",
        ["provider"],
        unique=False,
    )


def downgrade() -> None:
    """Remove model configuration persistence."""
    op.drop_index(
        op.f("ix_model_configurations_provider"),
        table_name="model_configurations",
    )
    op.drop_index(
        op.f("ix_model_configurations_display_name"),
        table_name="model_configurations",
    )
    op.drop_index(
        op.f("ix_model_configurations_active"),
        table_name="model_configurations",
    )
    op.drop_table("model_configurations")
