"""Database engine and request-scoped session configuration."""

import os
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///./llm_eval.db"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


async def _set_sqlite_pragmas(driver_connection: Any) -> None:
    """Apply connection-local SQLite safety settings through aiosqlite."""
    for statement in ("PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000"):
        cursor = await driver_connection.execute(statement)
        await cursor.close()


def _configure_sqlite(dbapi_connection: Any, connection_record: Any) -> None:
    """Bridge SQLAlchemy's synchronous event to the async SQLite driver."""
    dbapi_connection.run_async(_set_sqlite_pragmas)


def create_database_engine(database_url: str = DATABASE_URL) -> AsyncEngine:
    """Create the async engine used by the application or an isolated test."""
    database_engine = create_async_engine(database_url)
    if database_url.startswith("sqlite+aiosqlite"):
        event.listen(database_engine.sync_engine, "connect", _configure_sqlite)
    return database_engine


engine = create_database_engine()
SessionFactory = async_sessionmaker(engine, expire_on_commit=False)


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the application session factory for background work."""
    return SessionFactory


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield one async database session per API request."""
    async with SessionFactory() as session:
        yield session
