"""Request and response schemas for one-shot playground generations."""

from pydantic import BaseModel, Field, field_validator

from .models import ProviderType


class PlaygroundRequest(BaseModel):
    """One model and prompt pair to execute without persistence."""

    model_id: int = Field(gt=0)
    prompt: str = Field(min_length=1)
    system_prompt: str | None = None

    @field_validator("prompt")
    @classmethod
    def strip_prompt(cls, value: str) -> str:
        """Reject prompts that contain only whitespace."""
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("system_prompt")
    @classmethod
    def normalize_system_prompt(cls, value: str | None) -> str | None:
        """Treat an empty optional system prompt as absent."""
        if value is None:
            return None
        return value.strip() or None


class PlaygroundResponse(BaseModel):
    """Normalized text generation and provider usage metrics."""

    model_id: int
    display_name: str
    provider: ProviderType
    model_name: str
    response: str
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    finish_reason: str | None
