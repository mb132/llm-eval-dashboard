"""Database connection safety-setting tests."""

import asyncio
from pathlib import Path

from app.database import create_database_engine
from sqlalchemy import text


def test_sqlite_connections_enable_safety_pragmas(tmp_path: Path) -> None:
    async def inspect_connection() -> tuple[int, int]:
        engine = create_database_engine(
            f"sqlite+aiosqlite:///{tmp_path / 'settings.db'}"
        )
        try:
            async with engine.connect() as connection:
                foreign_keys = await connection.scalar(text("PRAGMA foreign_keys"))
                busy_timeout = await connection.scalar(text("PRAGMA busy_timeout"))
                return int(foreign_keys or 0), int(busy_timeout or 0)
        finally:
            await engine.dispose()

    assert asyncio.run(inspect_connection()) == (1, 5000)
