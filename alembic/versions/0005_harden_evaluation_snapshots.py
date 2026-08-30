"""Persist immutable model configuration snapshots for evaluations.

Revision ID: 0005_harden_evaluation_snapshots
Revises: 0004_create_model_configurations
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_harden_evaluation_snapshots"
down_revision: str | None = "0004_create_model_configurations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable snapshot fields so historical results remain readable."""
    with op.batch_alter_table("evaluation_results") as batch_op:
        batch_op.add_column(sa.Column("provider_model_name", sa.String(300)))
        batch_op.add_column(sa.Column("model_base_url", sa.String(2000)))
        batch_op.add_column(sa.Column("model_parameters", sa.JSON()))


def downgrade() -> None:
    """Remove persisted model configuration snapshots."""
    with op.batch_alter_table("evaluation_results") as batch_op:
        batch_op.drop_column("model_parameters")
        batch_op.drop_column("model_base_url")
        batch_op.drop_column("provider_model_name")
