"""One-shot prompt execution endpoint for configured models."""

from fastapi import APIRouter, HTTPException

from ..models import ModelConfiguration
from ..schemas.playground import PlaygroundRequest, PlaygroundResponse
from ..services import model_service
from ..services.openrouter_metadata import refresh_model_price
from ..services.playground import (
    PlaygroundConfigurationError,
    PlaygroundProviderError,
    PlaygroundTimeoutError,
    generate_prompt,
)
from .models import SessionDependency

router = APIRouter(prefix="/api/playground", tags=["playground"])


@router.post("/run", response_model=PlaygroundResponse)
async def run_playground_prompt(
    payload: PlaygroundRequest,
    session: SessionDependency,
) -> PlaygroundResponse:
    """Run a prompt against an active persisted model configuration."""
    model = await model_service.get_model(session, payload.model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model configuration not found.")
    if not model.active:
        raise HTTPException(status_code=409, detail="The selected model is inactive.")

    await refresh_model_price(session, model)

    result = await _generate_or_http_error(model, payload)
    return PlaygroundResponse(
        model_id=model.id or payload.model_id,
        display_name=model.display_name,
        provider=model.provider.kind,
        model_name=model.model_name,
        response=result.response,
        latency_ms=result.latency_ms,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        total_tokens=result.total_tokens,
        finish_reason=result.finish_reason,
    )


async def _generate_or_http_error(
    model: ModelConfiguration,
    payload: PlaygroundRequest,
):
    try:
        return await generate_prompt(model, payload.prompt, payload.system_prompt)
    except PlaygroundConfigurationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except PlaygroundTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except PlaygroundProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
