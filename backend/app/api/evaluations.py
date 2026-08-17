"""Endpoint for the first hardcoded LLM evaluation."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.ollama import OllamaError, run_evaluation

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])

TEST_QUESTION = "What is the capital of France?"
EVALUATION_PROMPT = (
    "Answer the following question accurately and concisely. "
    "Return only the answer, without additional explanation."
)


class EvaluationResponse(BaseModel):
    """Normalized result returned to the frontend."""

    model: str
    response: str
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None


@router.post("/run", response_model=EvaluationResponse)
async def run_hardcoded_evaluation() -> EvaluationResponse:
    """Run the single hardcoded prompt and question against local Ollama."""
    try:
        result = await run_evaluation(EVALUATION_PROMPT, TEST_QUESTION)
    except OllamaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return EvaluationResponse(
        model=result.model,
        response=result.response,
        latency_ms=result.latency_ms,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )
