import asyncio

import pytest
from app.api import playground
from app.models import ModelConfiguration
from app.services.playground import (
    PlaygroundConfigurationError,
    PlaygroundProviderError,
    PlaygroundResult,
    PlaygroundTimeoutError,
)
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@pytest.fixture
def client_and_session_factory(
    prompt_client: TestClient,
    evaluation_session_factory: async_sessionmaker[AsyncSession],
) -> tuple[TestClient, async_sessionmaker[AsyncSession]]:
    return prompt_client, evaluation_session_factory


def add_model(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    provider: str = "ollama",
    base_url: str | None = None,
    api_key_env_var: str | None = None,
    active: bool = True,
    parameters: dict | None = None,
) -> ModelConfiguration:
    async def persist() -> ModelConfiguration:
        async with session_factory() as session:
            model = ModelConfiguration(
                display_name="Local Gemma",
                provider=provider,
                model_name="gemma4:e4b",
                base_url=base_url,
                api_key_env_var=api_key_env_var,
                active=active,
                parameters=parameters or {},
            )
            session.add(model)
            await session.commit()
            await session.refresh(model)
            session.expunge(model)
            return model

    return asyncio.run(persist())


def test_playground_endpoint_dispatches_and_normalizes_response(
    client_and_session_factory,
    monkeypatch,
) -> None:
    client, session_factory = client_and_session_factory
    model = add_model(session_factory, parameters={"temperature": 0.2})

    async def fake_generate(stored_model, prompt, system_prompt):
        assert stored_model.id == model.id
        assert stored_model.parameters == {"temperature": 0.2}
        assert prompt == "Tell me a joke."
        assert system_prompt == "Keep it short."
        return PlaygroundResult(
            response="A concise joke.",
            latency_ms=321,
            input_tokens=10,
            output_tokens=4,
            total_tokens=14,
            finish_reason="stop",
        )

    monkeypatch.setattr(playground, "generate_prompt", fake_generate)
    response = client.post(
        "/api/playground/run",
        json={
            "model_id": model.id,
            "prompt": " Tell me a joke. ",
            "system_prompt": " Keep it short. ",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "model_id": model.id,
        "display_name": "Local Gemma",
        "provider": "ollama",
        "model_name": "gemma4:e4b",
        "response": "A concise joke.",
        "latency_ms": 321,
        "input_tokens": 10,
        "output_tokens": 4,
        "total_tokens": 14,
        "finish_reason": "stop",
    }


def test_playground_rejects_unknown_and_inactive_models(
    client_and_session_factory,
) -> None:
    client, session_factory = client_and_session_factory
    inactive = add_model(session_factory, active=False)

    assert (
        client.post(
            "/api/playground/run", json={"model_id": 999, "prompt": "Hello"}
        ).status_code
        == 404
    )
    response = client.post(
        "/api/playground/run",
        json={"model_id": inactive.id, "prompt": "Hello"},
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "The selected model is inactive."}


@pytest.mark.parametrize(
    ("provider", "expected_detail"),
    [
        ("custom", "executable protocol"),
        ("openai", "requires configured credentials"),
        ("openai_compatible", "require a base URL"),
    ],
)
def test_playground_rejects_models_that_cannot_execute(
    client_and_session_factory,
    provider: str,
    expected_detail: str,
) -> None:
    client, session_factory = client_and_session_factory
    model = add_model(session_factory, provider=provider)
    response = client.post(
        "/api/playground/run",
        json={"model_id": model.id, "prompt": "Hello"},
    )
    assert response.status_code == 422
    assert expected_detail in response.json()["detail"]


@pytest.mark.parametrize(
    ("exception", "expected_status"),
    [
        (PlaygroundConfigurationError("Bad configuration."), 422),
        (PlaygroundProviderError("Provider failed."), 502),
        (PlaygroundTimeoutError("Provider timed out."), 504),
    ],
)
def test_playground_maps_service_failures(
    client_and_session_factory,
    monkeypatch,
    exception,
    expected_status: int,
) -> None:
    client, session_factory = client_and_session_factory
    model = add_model(session_factory)

    async def fail(*_):
        raise exception

    monkeypatch.setattr(playground, "generate_prompt", fail)
    response = client.post(
        "/api/playground/run",
        json={"model_id": model.id, "prompt": "Hello"},
    )
    assert response.status_code == expected_status
    assert response.json() == {"detail": str(exception)}


def test_playground_rejects_blank_prompts_without_echoing_input(
    client_and_session_factory,
) -> None:
    client, session_factory = client_and_session_factory
    model = add_model(session_factory)
    response = client.post(
        "/api/playground/run",
        json={"model_id": model.id, "prompt": "   "},
    )
    assert response.status_code == 422
    assert '"input"' not in response.text
