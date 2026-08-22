"""Shared backend test fixtures."""

import asyncio
from collections.abc import Iterator

import pytest
from app.database import get_session
from app.main import app
from app.models import Base
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


@pytest.fixture
def prompt_client(tmp_path) -> Iterator[TestClient]:
    """Serve the API with an isolated, persistent SQLite database."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'prompts.db'}"
    engine = create_async_engine(database_url, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema() -> None:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def override_session():
        async with session_factory() as session:
            yield session

    asyncio.run(create_schema())
    app.dependency_overrides[get_session] = override_session
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        asyncio.run(engine.dispose())
