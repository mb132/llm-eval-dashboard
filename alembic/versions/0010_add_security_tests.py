"""Add security test classifications and immutable result scoring.

Revision ID: 0010_add_security_tests
Revises: 0009_add_model_pricing
Create Date: 2026-08-31
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_add_security_tests"
down_revision: str | None = "0009_add_model_pricing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SECURITY_TYPES = (
    "'direct_prompt_injection', 'instruction_override', 'system_prompt_extraction'"
)


def _add_case_columns(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch:
        batch.add_column(
            sa.Column(
                "case_type",
                sa.String(length=20),
                nullable=False,
                server_default="standard",
            )
        )
        batch.add_column(sa.Column("security_test_type", sa.String(length=50)))


def upgrade() -> None:
    """Classify legacy data as standard and add security result fields."""
    _add_case_columns("test_cases")
    with op.batch_alter_table("test_cases") as batch:
        batch.create_check_constraint(
            "case_type_valid", "case_type IN ('standard', 'security')"
        )
        batch.create_check_constraint(
            "security_type_consistent",
            "(case_type = 'standard' AND security_test_type IS NULL) OR "
            f"(case_type = 'security' AND security_test_type IN ({SECURITY_TYPES}))",
        )
        batch.alter_column(
            "case_type",
            existing_type=sa.String(length=20),
            server_default=None,
        )

    _add_case_columns("evaluation_results")
    with op.batch_alter_table("evaluation_results") as batch:
        batch.add_column(sa.Column("security_metric_version", sa.Integer()))
        batch.add_column(sa.Column("security_passed", sa.Boolean()))
        batch.create_check_constraint(
            "case_type_valid", "case_type IN ('standard', 'security')"
        )
        batch.create_check_constraint(
            "security_snapshot_consistent",
            "(case_type = 'standard' AND security_test_type IS NULL AND "
            "security_metric_version IS NULL AND security_passed IS NULL) OR "
            f"(case_type = 'security' AND security_test_type IN ({SECURITY_TYPES}) "
            "AND security_metric_version >= 1)",
        )
        batch.alter_column(
            "case_type",
            existing_type=sa.String(length=20),
            server_default=None,
        )


def downgrade() -> None:
    """Remove security classifications and result scoring."""
    with op.batch_alter_table("evaluation_results") as batch:
        batch.drop_constraint("security_snapshot_consistent", type_="check")
        batch.drop_constraint("case_type_valid", type_="check")
        batch.drop_column("security_passed")
        batch.drop_column("security_metric_version")
        batch.drop_column("security_test_type")
        batch.drop_column("case_type")
    with op.batch_alter_table("test_cases") as batch:
        batch.drop_constraint("security_type_consistent", type_="check")
        batch.drop_constraint("case_type_valid", type_="check")
        batch.drop_column("security_test_type")
        batch.drop_column("case_type")
