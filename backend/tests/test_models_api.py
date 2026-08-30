import asyncio
import os

import pytest
from app.models import ModelConfiguration
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@pytest.fixture
def client(prompt_client: TestClient) -> TestClient:
    return prompt_client


def test_model_configuration_crud_never_returns_secrets(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "super-secret-value")
    payload = {
        "display_name": "OpenAI Model",
        "provider": "openai",
        "model_name": "gpt-5",
        "api_key_env_var": "OPENAI_API_KEY",
        "parameters": {"temperature": 0.2, "max_tokens": 1000},
        "active": True,
    }

    created = client.post("/api/models", json=payload)

    assert created.status_code == 201
    body = created.json()
    assert body["id"] == 1
    assert body["has_credentials"] is True
    assert body["api_key_env_var"] == "OPENAI_API_KEY"
    assert "super-secret-value" not in created.text

    listed = client.get("/api/models")
    fetched = client.get("/api/models/1")
    assert listed.json() == [body]
    assert fetched.json() == body

    updated = client.patch(
        "/api/models/1",
        json={"display_name": "Primary judge", "active": False},
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Primary judge"
    assert updated.json()["active"] is False
    assert updated.json()["model_name"] == "gpt-5"

    deleted = client.delete("/api/models/1")
    assert deleted.status_code == 204
    assert client.get("/api/models/1").status_code == 404
    assert client.get("/api/models").json() == []


def test_ollama_and_openai_compatible_configurations_are_representable(
    client: TestClient,
) -> None:
    ollama = client.post(
        "/api/models",
        json={
            "display_name": "Local Gemma",
            "provider": "ollama",
            "model_name": "gemma4:e4b",
            "base_url": "http://localhost:11434",
        },
    )
    compatible = client.post(
        "/api/models",
        json={
            "display_name": "University endpoint",
            "provider": "openai_compatible",
            "model_name": "campus-model",
            "base_url": "https://example.edu/v1",
        },
    )

    assert ollama.status_code == 201
    assert ollama.json()["has_credentials"] is False
    assert compatible.status_code == 201
    assert compatible.json()["provider"] == "openai_compatible"


def test_api_key_value_is_not_persisted(
    client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "never-store-this")
    response = client.post(
        "/api/models",
        json={
            "display_name": "Claude",
            "provider": "anthropic",
            "model_name": "claude-model",
            "api_key_env_var": "ANTHROPIC_API_KEY",
        },
    )
    assert response.status_code == 201

    async def load_stored_model() -> ModelConfiguration:
        async with evaluation_session_factory() as session:
            return (await session.scalars(select(ModelConfiguration))).one()

    stored = asyncio.run(load_stored_model())
    assert stored.api_key_env_var == "ANTHROPIC_API_KEY"
    assert "never-store-this" not in repr(stored)
    assert not hasattr(stored, "api_key")


def test_invalid_provider_and_environment_variable_are_rejected(
    client: TestClient,
) -> None:
    base_payload = {
        "display_name": "Example",
        "model_name": "model",
    }

    invalid_provider = client.post(
        "/api/models", json={**base_payload, "provider": "arbitrary_python_class"}
    )
    invalid_env_name = client.post(
        "/api/models",
        json={
            **base_payload,
            "provider": "custom",
            "api_key_env_var": "actual-secret-value!",
        },
    )

    assert invalid_provider.status_code == 422
    assert invalid_env_name.status_code == 422
    assert "actual-secret-value!" not in invalid_env_name.text
    assert "actual-secret-value!" not in os.environ


def test_model_parameters_are_bounded(client: TestClient) -> None:
    response = client.post(
        "/api/models",
        json={
            "display_name": "Oversized",
            "provider": "ollama",
            "model_name": "test-model",
            "parameters": {"value": "x" * 20_000},
        },
    )

    assert response.status_code == 422
    assert "at most 20000 bytes" in response.text


@pytest.mark.parametrize(
    "payload",
    [
        {
            "provider": "openai",
            "api_key_env_var": "AWS_SECRET_ACCESS_KEY",
        },
        {
            "provider": "openai",
            "base_url": "https://attacker.example/v1",
        },
        {
            "provider": "openai_compatible",
            "base_url": "https://attacker.example/v1",
            "api_key_env_var": "OPENAI_API_KEY",
        },
    ],
)
def test_model_configuration_rejects_credential_forwarding_combinations(
    client: TestClient,
    payload: dict,
) -> None:
    response = client.post(
        "/api/models",
        json={
            "display_name": "Example",
            "model_name": "model",
            **payload,
        },
    )

    assert response.status_code == 422


def test_sqlite_configuration_persists_between_sessions(
    evaluation_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async def persist_and_reload() -> ModelConfiguration:
        async with evaluation_session_factory() as session:
            session.add(
                ModelConfiguration(
                    display_name="Local Gemma",
                    provider="ollama",
                    model_name="gemma4:e4b",
                    base_url="http://localhost:11434",
                )
            )
            await session.commit()
        async with evaluation_session_factory() as session:
            return (await session.scalars(select(ModelConfiguration))).one()

    persisted = asyncio.run(persist_and_reload())
    assert persisted.display_name == "Local Gemma"
    assert persisted.model_name == "gemma4:e4b"
