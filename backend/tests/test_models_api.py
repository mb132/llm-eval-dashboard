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


def test_openrouter_requires_a_key_to_run_and_uses_no_direct_provider_pricing(
    client: TestClient,
) -> None:
    provider = create_provider(client, kind="openrouter")
    assert provider["base_url"] is None
    assert provider["api_key_requirement"] == "required"
    model = client.post(
        "/api/models",
        json={
            "display_name": "Routed model",
            "provider_id": provider["id"],
            "model_name": "openai/gpt-5.6-sol",
        },
    )
    assert model.status_code == 201
    assert model.json()["model_name"] == "openai/gpt-5.6-sol"
    assert model.json()["pricing"] is None
    assert model.json()["runnable"] is False

    configured = client.patch(
        f"/api/providers/{provider['id']}", json={"api_key": "openrouter-secret"}
    )
    assert configured.status_code == 200
    assert "openrouter-secret" not in configured.text
    loaded = client.get(f"/api/models/{model.json()['id']}")
    assert loaded.json()["runnable"] is True
    assert "openrouter-secret" not in loaded.text
    invalid = client.post(
        "/api/providers",
        json={
            "display_name": "Invalid OpenRouter endpoint",
            "kind": "openrouter",
            "base_url": "https://example.test/v1",
        },
    )
    assert invalid.status_code == 422


def test_model_provider_switch_and_identity_pricing_rules(client: TestClient) -> None:
    original = create_provider(client, kind="openai", api_key="openai-secret")
    replacement = create_provider(client, kind="openrouter", api_key="router-secret")
    created = client.post(
        "/api/models",
        json={
            "display_name": "Shared model",
            "provider_id": original["id"],
            "model_name": "gpt-5.6-sol",
            "pricing": {
                "mode": "manual",
                "input_usd_per_million_tokens": "1",
                "output_usd_per_million_tokens": "2",
            },
        },
    )
    assert created.status_code == 201
    model_id = created.json()["id"]
    unchanged = client.patch(
        f"/api/models/{model_id}",
        json={
            "display_name": "Renamed",
            "provider_id": original["id"],
            "model_name": "gpt-5.6-sol",
        },
    )
    assert unchanged.json()["pricing"]["source"] == "manual"
    switched = client.patch(
        f"/api/models/{model_id}", json={"provider_id": replacement["id"]}
    )
    assert switched.status_code == 200
    assert switched.json()["provider"]["kind"] == "openrouter"
    assert switched.json()["pricing"] is None
    reloaded = client.get(f"/api/models/{model_id}").json()
    assert reloaded["provider"]["id"] == replacement["id"]
    override = client.patch(
        f"/api/models/{model_id}",
        json={
            "model_name": "anthropic/claude-test",
            "pricing": {
                "mode": "manual",
                "input_usd_per_million_tokens": "3",
                "output_usd_per_million_tokens": "4",
            },
        },
    )
    assert override.json()["pricing"]["source"] == "manual"
    assert override.json()["pricing"]["input_usd_per_million_tokens"] == "3.000000"


def test_model_pricing_supports_catalog_manual_and_unknown_models(
    client: TestClient,
) -> None:
    provider = create_provider(client, kind="openai", api_key="test-key")
    catalog = client.post(
        "/api/models",
        json={
            "display_name": "Catalog model",
            "provider_id": provider["id"],
            "model_name": "gpt-5.6-sol",
        },
    )

    assert catalog.status_code == 201
    assert catalog.json()["pricing"] == {
        "input_usd_per_million_tokens": "4.000000",
        "output_usd_per_million_tokens": "20.000000",
        "currency": "USD",
        "source": "catalog",
        "effective_date": "2026-08-31",
        "source_url": "https://developers.openai.com/api/docs/models",
        "fetched_at": None,
        "stale": False,
    }

    manual = client.patch(
        f"/api/models/{catalog.json()['id']}",
        json={
            "pricing": {
                "mode": "manual",
                "input_usd_per_million_tokens": "0.125",
                "output_usd_per_million_tokens": "0",
            }
        },
    )
    assert manual.status_code == 200
    assert manual.json()["pricing"]["source"] == "manual"
    assert manual.json()["pricing"]["input_usd_per_million_tokens"] == "0.125000"

    unknown = client.post(
        "/api/models",
        json={
            "display_name": "Future model",
            "provider_id": provider["id"],
            "model_name": "future-model",
        },
    )
    assert unknown.status_code == 201
    assert unknown.json()["pricing"] is None


@pytest.mark.parametrize(
    "pricing",
    [
        {"mode": "manual", "input_usd_per_million_tokens": "1"},
        {
            "mode": "manual",
            "input_usd_per_million_tokens": "0.1234567",
            "output_usd_per_million_tokens": "1",
        },
        {
            "mode": "catalog",
            "input_usd_per_million_tokens": "1",
            "output_usd_per_million_tokens": "1",
        },
    ],
)
def test_invalid_model_pricing_is_rejected(client: TestClient, pricing: dict) -> None:
    provider = create_provider(client)
    response = client.post(
        "/api/models",
        json={
            "display_name": "Invalid price",
            "provider_id": provider["id"],
            "model_name": "model",
            "pricing": pricing,
        },
    )

    assert response.status_code == 422


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
    provider = create_provider(client, kind="anthropic", api_key="never-store-this")
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
