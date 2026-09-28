"""Snapshot test categories with evaluation results.

Revision ID: 0011_snapshot_result_categories
Revises: 0010_add_security_tests
Create Date: 2026-09-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_snapshot_result_categories"
down_revision: str | None = "0010_add_security_tests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Keep the test category that was present when a run was created."""
    with op.batch_alter_table("evaluation_results") as batch:
        batch.add_column(sa.Column("test_category", sa.String(length=100)))


def downgrade() -> None:
    """Remove the immutable category snapshot."""
    with op.batch_alter_table("evaluation_results") as batch:
        batch.drop_column("test_category")
