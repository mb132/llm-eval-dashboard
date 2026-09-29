"""Add system prompt support to prompt and result snapshots.

Revision ID: 0013_add_system_prompts
Revises: 0012_create_dataset_import_receipts
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0013_add_system_prompts"
down_revision: str | None = "0012_create_dataset_import_receipts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("prompt_versions") as batch:
        batch.add_column(sa.Column("system_prompt", sa.Text(), nullable=True))
    with op.batch_alter_table("evaluation_results") as batch:
        batch.add_column(sa.Column("system_prompt", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("evaluation_results") as batch:
        batch.drop_column("system_prompt")
    with op.batch_alter_table("prompt_versions") as batch:
        batch.drop_column("system_prompt")
