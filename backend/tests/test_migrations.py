"""Migration lifecycle tests for the SQLite schema."""

import sqlite3
from pathlib import Path

from alembic.config import Config

from alembic import command


def table_names(database_path: Path) -> set[str]:
    """Return user-managed SQLite table names."""
    with sqlite3.connect(database_path) as connection:
        rows = connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    return {row[0] for row in rows}


def test_migrations_upgrade_downgrade_and_reupgrade(tmp_path: Path) -> None:
    """Verify the complete schema migration lifecycle on a disposable database."""
    database_path = tmp_path / "migration.db"
    config = Config("alembic.ini")
    config.attributes["database_url"] = (
        f"sqlite+aiosqlite:///{database_path.as_posix()}"
    )

    command.upgrade(config, "head")
    assert table_names(database_path) == {
        "alembic_version",
        "datasets",
        "evaluation_results",
        "evaluation_runs",
        "prompt_versions",
        "prompts",
        "test_cases",
    }

    command.downgrade(config, "base")
    assert table_names(database_path) == {"alembic_version"}

    command.upgrade(config, "head")
    assert "prompt_versions" in table_names(database_path)
    assert "test_cases" in table_names(database_path)
    assert "evaluation_results" in table_names(database_path)
