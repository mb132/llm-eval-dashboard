"""CRUD endpoints for language-model configuration."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..schemas.models import (
    ModelConfigurationCreate,
    ModelConfigurationResponse,
    ModelConfigurationUpdate,
)
from ..services import model_service

router = APIRouter(prefix="/api/models", tags=["models"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=list[ModelConfigurationResponse])
async def list_model_configurations(
    session: SessionDependency,
) -> list[ModelConfigurationResponse]:
    """List every configured model without exposing credential values."""
    models = await model_service.list_models(session)
    return [model_service.to_response(model) for model in models]


@router.post(
    "",
    response_model=ModelConfigurationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_model_configuration(
    payload: ModelConfigurationCreate,
    session: SessionDependency,
) -> ModelConfigurationResponse:
    """Create a model configuration."""
    try:
        model = await model_service.create_model(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if model is None:
        raise HTTPException(status_code=422, detail="Provider configuration not found.")
    return model_service.to_response(model)


@router.get("/{model_id}", response_model=ModelConfigurationResponse)
async def get_model_configuration(
    model_id: int,
    session: SessionDependency,
) -> ModelConfigurationResponse:
    """Retrieve one model configuration."""
    model = await _get_model_or_404(session, model_id)
    return model_service.to_response(model)


@router.patch("/{model_id}", response_model=ModelConfigurationResponse)
async def update_model_configuration(
    model_id: int,
    payload: ModelConfigurationUpdate,
    session: SessionDependency,
) -> ModelConfigurationResponse:
    """Partially update one model configuration."""
    model = await _get_model_or_404(session, model_id)
    try:
        updated_model = await model_service.update_model(session, model, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if updated_model is None:
        raise HTTPException(status_code=422, detail="Provider configuration not found.")
    return model_service.to_response(updated_model)


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model_configuration(
    model_id: int, session: SessionDependency
) -> Response:
    """Remove one model configuration."""
    model = await _get_model_or_404(session, model_id)
    await model_service.delete_model(session, model)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _get_model_or_404(session: AsyncSession, model_id: int):
    model = await model_service.get_model(session, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Model configuration not found.")
    return model
