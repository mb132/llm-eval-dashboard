"""Shared Ollama result type, error type, and request limits.

Ollama connections are configured per provider in the web UI; requests are sent
through the playground service.
"""

from dataclasses import dataclass

REQUEST_TIMEOUT_SECONDS = 120.0
MAX_OUTPUT_TOKENS = 1_024


class OllamaError(RuntimeError):
    """Raised when Ollama cannot produce a usable evaluation response."""

    def __init__(self, message: str, *, code: str = "provider_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class OllamaResult:
    """Normalized subset of an Ollama response used by the application."""

    model: str
    response: str
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None = None
