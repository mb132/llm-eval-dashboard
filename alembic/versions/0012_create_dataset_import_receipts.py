"""Create idempotency receipts for dataset imports.

Revision ID: 0012_create_dataset_import_receipts
Revises: 0011_snapshot_result_categories
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012_create_dataset_import_receipts"
down_revision: str | None = "0011_snapshot_result_categories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dataset_import_receipts",
        sa.Column("import_id", sa.Uuid(), nullable=False),
        sa.Column("request_digest", sa.String(length=64), nullable=False),
        sa.Column("dataset_id", sa.Uuid(), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("import_id", name="pk_dataset_import_receipts"),
    )


def downgrade() -> None:
    op.drop_table("dataset_import_receipts")
