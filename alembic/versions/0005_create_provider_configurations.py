"""Create reusable encrypted provider configurations.

Revision ID: 0005_create_provider_configurations
Revises: 0004_create_model_configurations
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_create_provider_configurations"
down_revision: str | None = "0004_create_model_configurations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _provider_name(kind: str, base_url: str | None, used: set[str]) -> str:
    label = kind.replace("_", " ").title()
    if base_url:
        label = f"{label} ({base_url})"
    candidate = label
    suffix = 2
    while candidate in used:
        candidate = f"{label} ({suffix})"
        suffix += 1
    used.add(candidate)
    return candidate


def upgrade() -> None:
    op.create_table(
        "provider_configurations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("base_url", sa.String(length=2000), nullable=True),
        sa.Column("api_key_ciphertext", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_provider_configurations")),
        sa.UniqueConstraint(
            "display_name", name=op.f("uq_provider_configurations_display_name")
        ),
    )
    op.create_index(
        op.f("ix_provider_configurations_kind"),
        "provider_configurations",
        ["kind"],
        unique=False,
    )

    connection = op.get_bind()
    rows = list(
        connection.execute(
            sa.text(
                "SELECT id, provider, base_url, api_key_env_var, created_at FROM model_configurations ORDER BY id"
            )
        ).mappings()
    )
    provider_ids: dict[tuple[str, str | None, str | None], int] = {}
    used_names: set[str] = set()
    for row in rows:
        key = (row["provider"], row["base_url"], row["api_key_env_var"])
        if key not in provider_ids:
            result = connection.execute(
                sa.text(
                    "INSERT INTO provider_configurations (display_name, kind, base_url, api_key_ciphertext, created_at) VALUES (:name, :kind, :base_url, NULL, :created_at)"
                ),
                {
                    "name": _provider_name(
                        row["provider"], row["base_url"], used_names
                    ),
                    "kind": row["provider"],
                    "base_url": row["base_url"],
                    "created_at": row["created_at"],
                },
            )
            provider_ids[key] = int(result.lastrowid)

    with op.batch_alter_table("model_configurations") as batch:
        batch.add_column(sa.Column("provider_id", sa.Integer(), nullable=True))
    # SQLite permits the update only after the new column exists; repeat mapping now.
    for row in connection.execute(
        sa.text(
            "SELECT id, provider, base_url, api_key_env_var FROM model_configurations ORDER BY id"
        )
    ).mappings():
        key = (row["provider"], row["base_url"], row["api_key_env_var"])
        connection.execute(
            sa.text(
                "UPDATE model_configurations SET provider_id = :provider_id WHERE id = :id"
            ),
            {"provider_id": provider_ids[key], "id": row["id"]},
        )
    with op.batch_alter_table("model_configurations") as batch:
        batch.drop_index(op.f("ix_model_configurations_provider"))
        batch.drop_column("provider")
        batch.drop_column("base_url")
        batch.drop_column("api_key_env_var")
        batch.alter_column("provider_id", existing_type=sa.Integer(), nullable=False)
        batch.create_foreign_key(
            op.f("fk_model_configurations_provider_id_provider_configurations"),
            "provider_configurations",
            ["provider_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_index(
            op.f("ix_model_configurations_provider_id"), ["provider_id"], unique=False
        )


def downgrade() -> None:
    connection = op.get_bind()
    with op.batch_alter_table("model_configurations") as batch:
        batch.drop_index(op.f("ix_model_configurations_provider_id"))
        batch.drop_constraint(
            op.f("fk_model_configurations_provider_id_provider_configurations"),
            type_="foreignkey",
        )
        batch.add_column(sa.Column("provider", sa.String(length=50), nullable=True))
        batch.add_column(sa.Column("base_url", sa.String(length=2000), nullable=True))
        batch.add_column(
            sa.Column("api_key_env_var", sa.String(length=200), nullable=True)
        )
    connection.execute(
        sa.text(
            "UPDATE model_configurations SET provider = (SELECT kind FROM provider_configurations WHERE provider_configurations.id = model_configurations.provider_id), base_url = (SELECT base_url FROM provider_configurations WHERE provider_configurations.id = model_configurations.provider_id), api_key_env_var = CASE (SELECT kind FROM provider_configurations WHERE provider_configurations.id = model_configurations.provider_id) WHEN 'openai' THEN 'OPENAI_API_KEY' WHEN 'anthropic' THEN 'ANTHROPIC_API_KEY' WHEN 'gemini' THEN 'GEMINI_API_KEY' ELSE NULL END"
        )
    )
    with op.batch_alter_table("model_configurations") as batch:
        batch.alter_column(
            "provider", existing_type=sa.String(length=50), nullable=False
        )
        batch.create_index(
            op.f("ix_model_configurations_provider"), ["provider"], unique=False
        )
        batch.drop_column("provider_id")
    op.drop_index(
        op.f("ix_provider_configurations_kind"), table_name="provider_configurations"
    )
    op.drop_table("provider_configurations")
