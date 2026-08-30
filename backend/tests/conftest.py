"""Shared backend test fixtures."""

import asyncio
import base64
import os
from collections.abc import Iterator

import pytest
from app.database import get_session, get_session_factory
from app.main import app
from app.models import Base
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

os.environ.setdefault("LLM_EVAL_MASTER_KEY", base64.urlsafe_b64encode(b"t" * 32).decode())


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

    def override_session_factory():
        return session_factory

    asyncio.run(create_schema())
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_session_factory] = override_session_factory
    original_session_factory = app.state.evaluation_session_factory
    app.state.evaluation_session_factory = session_factory
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_session_factory, None)
        app.state.evaluation_session_factory = original_session_factory
        asyncio.run(engine.dispose())


@pytest.fixture
def evaluation_session_factory(
    prompt_client: TestClient,
) -> async_sessionmaker[AsyncSession]:
    """Expose the isolated session factory used by the API fixture."""
    return app.state.evaluation_session_factory
