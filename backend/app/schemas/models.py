"""Validation schemas for model configuration endpoints."""

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .providers import ProviderSummary

MAX_PARAMETERS_JSON_BYTES = 20_000


class PricingSelection(BaseModel):
    """Pricing choice supplied when creating or updating a model."""

    mode: Literal["catalog", "automatic", "manual", "unavailable"] = "catalog"
    input_usd_per_million_tokens: Decimal | None = None
    output_usd_per_million_tokens: Decimal | None = None

    @model_validator(mode="after")
    def validate_mode(self) -> Self:
        rates = (
            self.input_usd_per_million_tokens,
            self.output_usd_per_million_tokens,
        )
        if self.mode == "manual":
            if any(rate is None for rate in rates):
                raise ValueError("manual pricing requires input and output prices")
            for rate in rates:
                assert rate is not None
                if not rate.is_finite() or rate < 0 or rate > 1000:
                    raise ValueError("prices must be between 0 and 1000 USD")
                exponent = rate.as_tuple().exponent
                if isinstance(exponent, int) and exponent < -6:
                    raise ValueError("prices support at most 6 decimal places")
        elif any(rate is not None for rate in rates):
            raise ValueError("prices are only accepted in manual mode")
        return self


class ModelPricingResponse(BaseModel):
    input_usd_per_million_tokens: str
    output_usd_per_million_tokens: str
    currency: Literal["USD"]
    source: Literal["catalog", "openrouter", "manual"]
    effective_date: date
    source_url: str | None
    fetched_at: datetime | None = None
    stale: bool = False


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
    pricing: PricingSelection = Field(default_factory=PricingSelection)
    requests_per_minute: int | None = Field(default=None, ge=1, le=100_000)
    max_concurrent_requests: int | None = Field(default=None, ge=1, le=1_000)

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
    pricing: PricingSelection | None = None
    requests_per_minute: int | None = Field(default=None, ge=1, le=100_000)
    max_concurrent_requests: int | None = Field(default=None, ge=1, le=1_000)

    @model_validator(mode="after")
    def reject_explicit_null_pricing(self) -> Self:
        if "pricing" in self.model_fields_set and self.pricing is None:
            raise ValueError("pricing must not be null")
        return self

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
    pricing: ModelPricingResponse | None
    pricing_mode: Literal["catalog", "automatic", "manual", "unavailable"]
    pricing_fetched_at: datetime | None
    requests_per_minute: int | None
    max_concurrent_requests: int | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
