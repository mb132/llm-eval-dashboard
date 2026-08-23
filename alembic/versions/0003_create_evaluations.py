"""Create persisted evaluation runs and result snapshots.

Revision ID: 0003_create_evaluations
Revises: 0002_create_datasets
Create Date: 2026-08-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_create_evaluations"
down_revision: str | None = "0002_create_datasets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create run tracking and immutable result snapshot tables."""
    op.create_table(
        "evaluation_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("dataset_id", sa.Uuid(), nullable=False),
        sa.Column("dataset_name", sa.String(length=120), nullable=False),
        sa.Column("repetitions", sa.Integer(), nullable=False),
        sa.Column("total_requests", sa.Integer(), nullable=False),
        sa.Column("completed_requests", sa.Integer(), nullable=False),
        sa.Column("successful_requests", sa.Integer(), nullable=False),
        sa.Column("failed_requests", sa.Integer(), nullable=False),
        sa.Column("failure_message", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed')",
            name=op.f("ck_evaluation_runs_status_valid"),
        ),
        sa.CheckConstraint(
            "repetitions >= 1",
            name=op.f("ck_evaluation_runs_repetitions_positive"),
        ),
        sa.CheckConstraint(
            "total_requests >= 1",
            name=op.f("ck_evaluation_runs_total_requests_positive"),
        ),
        sa.CheckConstraint(
            "completed_requests >= 0 AND completed_requests <= total_requests",
            name=op.f("ck_evaluation_runs_completed_requests_valid"),
        ),
        sa.CheckConstraint(
            "successful_requests >= 0 AND failed_requests >= 0",
            name=op.f("ck_evaluation_runs_result_counts_nonnegative"),
        ),
        sa.CheckConstraint(
            "successful_requests + failed_requests = completed_requests",
            name=op.f("ck_evaluation_runs_result_counts_consistent"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_evaluation_runs")),
    )
    op.create_table(
        "evaluation_results",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("evaluation_id", sa.Uuid(), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("model_id", sa.String(length=100), nullable=False),
        sa.Column("model_provider", sa.String(length=50), nullable=False),
        sa.Column("model_name", sa.String(length=200), nullable=False),
        sa.Column("reported_model_name", sa.String(length=200), nullable=True),
        sa.Column("prompt_id", sa.Uuid(), nullable=False),
        sa.Column("prompt_version_id", sa.Uuid(), nullable=False),
        sa.Column("prompt_name", sa.String(length=120), nullable=False),
        sa.Column("prompt_version_number", sa.Integer(), nullable=False),
        sa.Column("test_case_id", sa.Uuid(), nullable=False),
        sa.Column("repetition", sa.Integer(), nullable=False),
        sa.Column("max_output_tokens", sa.Integer(), nullable=False),
        sa.Column("rendered_prompt", sa.Text(), nullable=False),
        sa.Column("test_input", sa.Text(), nullable=False),
        sa.Column("expected_output", sa.Text(), nullable=False),
        sa.Column("generated_output", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=50), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'failed')",
            name=op.f("ck_evaluation_results_status_valid"),
        ),
        sa.CheckConstraint(
            "sequence_number >= 1",
            name=op.f("ck_evaluation_results_sequence_number_positive"),
        ),
        sa.CheckConstraint(
            "repetition >= 1",
            name=op.f("ck_evaluation_results_repetition_positive"),
        ),
        sa.CheckConstraint(
            "max_output_tokens >= 1",
            name=op.f("ck_evaluation_results_max_output_tokens_positive"),
        ),
        sa.CheckConstraint(
            "latency_ms IS NULL OR latency_ms >= 0",
            name=op.f("ck_evaluation_results_latency_nonnegative"),
        ),
        sa.CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name=op.f("ck_evaluation_results_input_tokens_nonnegative"),
        ),
        sa.CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name=op.f("ck_evaluation_results_output_tokens_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["evaluation_id"],
            ["evaluation_runs.id"],
            name=op.f("fk_evaluation_results_evaluation_id_evaluation_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_evaluation_results")),
        sa.UniqueConstraint(
            "evaluation_id",
            "sequence_number",
            name="uq_evaluation_results_evaluation_id_sequence_number",
        ),
    )
    op.create_index(
        op.f("ix_evaluation_results_evaluation_id"),
        "evaluation_results",
        ["evaluation_id"],
        unique=False,
    )


def downgrade() -> None:
    """Remove evaluation result and run persistence."""
    op.drop_index(
        op.f("ix_evaluation_results_evaluation_id"),
        table_name="evaluation_results",
    )
    op.drop_table("evaluation_results")
    op.drop_table("evaluation_runs")
