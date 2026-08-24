"""Validation schemas for model configuration endpoints."""

import re
from datetime import datetime
from enum import StrEnum
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ENV_VAR_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class ProviderType(StrEnum):
    """Provider integrations representable by the first configuration schema."""

    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    OPENAI_COMPATIBLE = "openai_compatible"
    CUSTOM = "custom"


# Credentials are selected by the deployment, not by an API caller. In
# particular, never allow a caller to select an arbitrary process variable and
# combine it with an arbitrary endpoint.
CREDENTIAL_ENV_VAR_BY_PROVIDER = {
    ProviderType.OPENAI: "OPENAI_API_KEY",
    ProviderType.ANTHROPIC: "ANTHROPIC_API_KEY",
    ProviderType.GEMINI: "GEMINI_API_KEY",
}
PROVIDERS_WITH_CONFIGURABLE_BASE_URL = {
    ProviderType.OLLAMA,
    ProviderType.OPENAI_COMPATIBLE,
    ProviderType.CUSTOM,
}


def validate_provider_settings(
    provider: ProviderType | str,
    base_url: str | None,
    api_key_env_var: str | None,
) -> None:
    """Ensure caller-controlled endpoints can never receive server credentials."""
    provider_type = ProviderType(provider)
    expected_credential_name = CREDENTIAL_ENV_VAR_BY_PROVIDER.get(provider_type)
    if api_key_env_var and api_key_env_var != expected_credential_name:
        raise ValueError(
            "This provider does not support that credential environment variable."
        )
    if base_url and provider_type not in PROVIDERS_WITH_CONFIGURABLE_BASE_URL:
        raise ValueError("This provider does not support a custom base URL.")


class ModelConfigurationBase(BaseModel):
    """Fields shared by create requests and stored model configurations."""

    display_name: str = Field(min_length=1, max_length=200)
    provider: ProviderType
    model_name: str = Field(min_length=1, max_length=300)
    base_url: str | None = Field(default=None, max_length=2000)
    api_key_env_var: str | None = Field(default=None, max_length=200)
    parameters: dict[str, Any] = Field(default_factory=dict)
    active: bool = True

    @field_validator("display_name", "model_name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        """Reject text fields containing only whitespace."""
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("base_url", "api_key_env_var")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        """Store empty optional inputs as null."""
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def validate_environment_variable(self) -> Self:
        """Accept environment variable names, never credential values."""
        if self.api_key_env_var and not ENV_VAR_PATTERN.fullmatch(self.api_key_env_var):
            raise ValueError(
                "api_key_env_var must be a valid environment variable name"
            )
        validate_provider_settings(self.provider, self.base_url, self.api_key_env_var)
        return self


class ModelConfigurationCreate(ModelConfigurationBase):
    """Payload used to create a model configuration."""


class ModelConfigurationUpdate(BaseModel):
    """Partial model configuration update."""

    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    provider: ProviderType | None = None
    model_name: str | None = Field(default=None, min_length=1, max_length=300)
    base_url: str | None = Field(default=None, max_length=2000)
    api_key_env_var: str | None = Field(default=None, max_length=200)
    parameters: dict[str, Any] | None = None
    active: bool | None = None

    @field_validator("display_name", "model_name")
    @classmethod
    def strip_optional_required_text(cls, value: str | None) -> str | None:
        """Reject null or blank values for required stored text fields."""
        if value is None:
            raise ValueError("must not be null")
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("base_url", "api_key_env_var")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        """Normalize optional strings while allowing clients to clear them."""
        if value is None:
            return None
        return value.strip() or None

    @field_validator("api_key_env_var")
    @classmethod
    def validate_environment_variable(cls, value: str | None) -> str | None:
        """Only accept a credential reference shaped like an environment name."""
        if value and not ENV_VAR_PATTERN.fullmatch(value):
            raise ValueError("must be a valid environment variable name")
        return value


class ModelConfigurationResponse(ModelConfigurationBase):
    """Safe frontend representation containing no resolved secret value."""

    id: int
    has_credentials: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
