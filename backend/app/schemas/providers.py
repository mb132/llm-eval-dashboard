"""Validation and safe response schemas for reusable provider connections."""

from datetime import datetime
from enum import StrEnum
from ipaddress import ip_address
from typing import Literal, Self
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ProviderType(StrEnum):
    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    OPENAI_COMPATIBLE = "openai_compatible"
    CUSTOM = "custom"


DEFAULT_BASE_URLS = {ProviderType.OLLAMA: "http://localhost:11434"}
FIXED_ENDPOINT_PROVIDERS = {
    ProviderType.OPENAI,
    ProviderType.ANTHROPIC,
    ProviderType.GEMINI,
}
KEY_REQUIRED_PROVIDERS = FIXED_ENDPOINT_PROVIDERS
KEY_OPTIONAL_PROVIDERS = {ProviderType.OLLAMA, ProviderType.OPENAI_COMPATIBLE}


def _is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def normalize_base_url(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("base_url must be an absolute HTTP or HTTPS URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("base_url cannot contain credentials, a query, or a fragment")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def validate_provider_settings(
    kind: ProviderType | str, base_url: str | None, api_key: str | None
) -> None:
    provider_type = ProviderType(kind)
    if provider_type in FIXED_ENDPOINT_PROVIDERS and base_url:
        raise ValueError("This provider uses a fixed official endpoint.")
    if (
        provider_type in {ProviderType.OPENAI_COMPATIBLE, ProviderType.CUSTOM}
        and not base_url
    ):
        raise ValueError("This provider requires a base URL.")
    if provider_type == ProviderType.CUSTOM and api_key:
        raise ValueError("Custom endpoints cannot store credentials.")
    if api_key and base_url:
        parsed = urlsplit(base_url)
        if parsed.scheme != "https" and not _is_loopback_host(parsed.hostname or ""):
            raise ValueError(
                "A provider API key requires HTTPS unless the endpoint is localhost."
            )


def credential_requirement(
    kind: ProviderType | str,
) -> Literal["required", "optional", "unsupported"]:
    provider_type = ProviderType(kind)
    if provider_type in KEY_REQUIRED_PROVIDERS:
        return "required"
    if provider_type in KEY_OPTIONAL_PROVIDERS:
        return "optional"
    return "unsupported"


class ProviderConfigurationCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    kind: ProviderType
    base_url: str | None = Field(default=None, max_length=2000)
    api_key: str | None = Field(default=None, min_length=1, max_length=10_000)

    @field_validator("display_name")
    @classmethod
    def strip_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        return normalize_base_url(value)

    @field_validator("api_key")
    @classmethod
    def strip_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @model_validator(mode="after")
    def validate_settings(self) -> Self:
        if self.kind == ProviderType.OLLAMA and self.base_url is None:
            self.base_url = DEFAULT_BASE_URLS[self.kind]
        validate_provider_settings(self.kind, self.base_url, self.api_key)
        return self


class ProviderConfigurationUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    base_url: str | None = Field(default=None, max_length=2000)
    api_key: str | None = Field(default=None, max_length=10_000)

    @field_validator("display_name")
    @classmethod
    def strip_display_name(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("must not be null")
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        return normalize_base_url(value)

    @field_validator("api_key")
    @classmethod
    def strip_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ProviderSummary(BaseModel):
    id: int
    display_name: str
    kind: ProviderType
    base_url: str | None
    has_api_key: bool
    api_key_requirement: Literal["required", "optional", "unsupported"]

    model_config = ConfigDict(from_attributes=True)


class ProviderConfigurationResponse(ProviderSummary):
    model_count: int
    created_at: datetime
