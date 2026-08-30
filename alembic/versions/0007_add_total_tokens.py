"""Add persisted total token usage.

Revision ID: 0007_add_total_tokens
Revises: 0006_create_quality_scores
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_add_total_tokens"
down_revision: str | None = "0006_create_quality_scores"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable usage without inventing values for historical results."""
    with op.batch_alter_table("evaluation_results") as batch_op:
        batch_op.add_column(sa.Column("total_tokens", sa.Integer(), nullable=True))
        batch_op.create_check_constraint(
            "total_tokens_nonnegative",
            "total_tokens IS NULL OR total_tokens >= 0",
        )
        batch_op.create_check_constraint(
            "input_tokens_bounded",
            "input_tokens IS NULL OR input_tokens <= 1000000000",
        )
        batch_op.create_check_constraint(
            "output_tokens_bounded",
            "output_tokens IS NULL OR output_tokens <= 1000000000",
        )
        batch_op.create_check_constraint(
            "total_tokens_bounded",
            "total_tokens IS NULL OR total_tokens <= 1000000000",
        )


def downgrade() -> None:
    """Remove persisted total token usage."""
    with op.batch_alter_table("evaluation_results") as batch_op:
        batch_op.drop_constraint(
            op.f("ck_evaluation_results_total_tokens_bounded"),
            type_="check",
        )
        batch_op.drop_constraint(
            op.f("ck_evaluation_results_output_tokens_bounded"),
            type_="check",
        )
        batch_op.drop_constraint(
            op.f("ck_evaluation_results_input_tokens_bounded"),
            type_="check",
        )
        batch_op.drop_constraint(
            op.f("ck_evaluation_results_total_tokens_nonnegative"),
            type_="check",
        )
        batch_op.drop_column("total_tokens")
