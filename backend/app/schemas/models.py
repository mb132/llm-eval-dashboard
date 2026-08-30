"""Validation schemas for model configuration endpoints."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .providers import ProviderSummary


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
