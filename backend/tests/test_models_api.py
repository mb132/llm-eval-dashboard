import asyncio
import os

import pytest
from app.models import ModelConfiguration, ProviderConfiguration
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@pytest.fixture
def client(prompt_client: TestClient) -> TestClient:
    return prompt_client


def create_provider(
    client: TestClient,
    *,
    kind: str = "ollama",
    base_url: str | None = None,
    api_key: str | None = None,
) -> dict:
    response = client.post(
        "/api/providers",
        json={
            "display_name": f"{kind} provider",
            "kind": kind,
            "base_url": base_url,
            "api_key": api_key,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_model_configuration_crud_never_returns_secrets(client: TestClient) -> None:
    provider = create_provider(client, kind="openai", api_key="super-secret-value")
    payload = {
        "display_name": "OpenAI Model",
        "provider_id": provider["id"],
        "model_name": "gpt-5",
        "parameters": {"temperature": 0.2, "max_tokens": 1000},
        "active": True,
    }

    created = client.post("/api/models", json=payload)

    assert created.status_code == 201
    body = created.json()
    assert body["id"] == 1
    assert body["provider"]["has_api_key"] is True
    assert "super-secret-value" not in created.text

    listed = client.get("/api/models")
    fetched = client.get(f"/api/models/{body['id']}")
    assert listed.json() == [body]
    assert fetched.json() == body

    updated = client.patch(
        f"/api/models/{body['id']}",
        json={"display_name": "Primary judge", "active": False},
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Primary judge"
    assert updated.json()["active"] is False
    assert updated.json()["model_name"] == "gpt-5"

    deleted = client.delete(f"/api/models/{body['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/models/{body['id']}").status_code == 404
    assert client.get("/api/models").json() == []


def test_ollama_and_openai_compatible_configurations_are_representable(
    client: TestClient,
) -> None:
    ollama_provider = create_provider(
        client, kind="ollama", base_url="http://localhost:11434"
    )
    compatible_provider = create_provider(
        client, kind="openai_compatible", base_url="https://example.edu/v1"
    )
    ollama = client.post(
        "/api/models",
        json={
            "display_name": "Local Gemma",
            "provider_id": ollama_provider["id"],
            "model_name": "gemma4:e4b",
        },
    )
    compatible = client.post(
        "/api/models",
        json={
            "display_name": "University endpoint",
            "provider_id": compatible_provider["id"],
            "model_name": "campus-model",
        },
    )

    assert ollama.status_code == 201
    assert ollama.json()["provider"]["has_api_key"] is False
    assert compatible.status_code == 201
    assert compatible.json()["provider"]["kind"] == "openai_compatible"


def test_api_key_value_is_not_persisted(
    client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    provider = create_provider(
        client, kind="anthropic", api_key="never-store-this"
    )
    response = client.post(
        "/api/models",
        json={
            "display_name": "Claude",
            "provider_id": provider["id"],
            "model_name": "claude-model",
        },
    )
    assert response.status_code == 201

    async def load_stored_provider() -> ProviderConfiguration:
        async with evaluation_session_factory() as session:
            return (await session.scalars(select(ProviderConfiguration))).one()

    stored = asyncio.run(load_stored_provider())
    assert "never-store-this" not in repr(stored)
    assert stored.api_key_ciphertext is not None


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
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
) -> None:
    provider = create_provider(
        prompt_client, kind="ollama", base_url="http://localhost:11434"
    )

    async def persist_and_reload() -> ModelConfiguration:
        async with evaluation_session_factory() as session:
            session.add(
                ModelConfiguration(
                    display_name="Local Gemma",
                    provider_id=provider["id"],
                    model_name="gemma4:e4b",
                )
            )
            await session.commit()
        async with evaluation_session_factory() as session:
            return (await session.scalars(select(ModelConfiguration))).one()

    persisted = asyncio.run(persist_and_reload())
    assert persisted.display_name == "Local Gemma"
    assert persisted.model_name == "gemma4:e4b"
