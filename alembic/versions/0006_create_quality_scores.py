"""Create versioned response quality scores.

Revision ID: 0006_create_quality_scores
Revises: 0005_harden_evaluation_snapshots
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_create_quality_scores"
down_revision: str | None = "0005_harden_evaluation_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create quality scores without rewriting historical results."""
    op.create_table(
        "evaluation_quality_scores",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("result_id", sa.Uuid(), nullable=False),
        sa.Column("method", sa.String(50), nullable=False),
        sa.Column("metric_version", sa.Integer(), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "metric_version >= 1",
            name=op.f("ck_evaluation_quality_scores_metric_version_positive"),
        ),
        sa.CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 1)",
            name=op.f("ck_evaluation_quality_scores_score_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["result_id"],
            ["evaluation_results.id"],
            name=op.f("fk_evaluation_quality_scores_result_id_evaluation_results"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_evaluation_quality_scores")),
        sa.UniqueConstraint(
            "result_id",
            "method",
            "metric_version",
            name="uq_quality_scores_result_method_version",
        ),
    )
    op.create_index(
        op.f("ix_evaluation_quality_scores_result_id"),
        "evaluation_quality_scores",
        ["result_id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove response quality scores."""
    op.drop_index(
        op.f("ix_evaluation_quality_scores_result_id"),
        table_name="evaluation_quality_scores",
    )
    op.drop_table("evaluation_quality_scores")
