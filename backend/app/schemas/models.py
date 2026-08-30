"""Validation schemas for model configuration endpoints."""

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .providers import ProviderSummary

MAX_PARAMETERS_JSON_BYTES = 20_000


def validate_model_parameters(parameters: dict[str, Any]) -> dict[str, Any]:
    """Require a bounded, portable JSON object for provider parameters."""
    try:
        serialized = json.dumps(
            parameters,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("parameters must contain valid finite JSON values") from exc
    if len(serialized) > MAX_PARAMETERS_JSON_BYTES:
        raise ValueError(
            f"parameters must serialize to at most {MAX_PARAMETERS_JSON_BYTES} bytes"
        )
    return parameters


class ModelConfigurationBase(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    provider_id: int = Field(gt=0)
    model_name: str = Field(min_length=1, max_length=300)
    parameters: dict[str, Any] = Field(default_factory=dict)
    active: bool = True

    @field_validator("display_name", "model_name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("parameters")
    @classmethod
    def validate_parameters(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validate_model_parameters(value)


class ModelConfigurationCreate(ModelConfigurationBase):
    pass


class ModelConfigurationUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    provider_id: int | None = Field(default=None, gt=0)
    model_name: str | None = Field(default=None, min_length=1, max_length=300)
    parameters: dict[str, Any] | None = None
    active: bool | None = None

    @field_validator("display_name", "model_name")
    @classmethod
    def strip_optional_required_text(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("must not be null")
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("parameters")
    @classmethod
    def validate_parameters(cls, value: dict[str, Any] | None) -> dict[str, Any]:
        if value is None:
            raise ValueError("must not be null")
        return validate_model_parameters(value)


class ModelConfigurationResponse(BaseModel):
    id: int
    display_name: str
    provider: ProviderSummary
    model_name: str
    parameters: dict[str, Any]
    active: bool
    runnable: bool
    unavailable_reason: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
