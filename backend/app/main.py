"""FastAPI application serving the API and production frontend."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.datasets import router as datasets_router
from .api.evaluations import router as evaluations_router
from .api.models import router as models_router
from .api.playground import router as playground_router
from .api.prompts import router as prompts_router
from .api.providers import router as providers_router
from .database import SessionFactory
from .services.credentials import validate_master_key
from .services.evaluation_execution import fail_interrupted_runs


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Reconcile work interrupted by a previous local server process."""
    validate_master_key()
    await fail_interrupted_runs(application.state.evaluation_session_factory)
    yield


app = FastAPI(title="LLM Evaluation Platform", lifespan=lifespan)
app.state.evaluation_session_factory = SessionFactory
app.include_router(datasets_router)
app.include_router(evaluations_router)
app.include_router(models_router)
app.include_router(providers_router)
app.include_router(playground_router)
app.include_router(prompts_router)


@app.exception_handler(RequestValidationError)
async def safe_validation_error(
    _: Request, exception: RequestValidationError
) -> JSONResponse:
    """Return validation details without echoing potentially sensitive input."""
    safe_errors = [
        {key: value for key, value in error.items() if key not in {"input", "ctx"}}
        for error in exception.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": safe_errors})


FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
ASSETS_DIR = FRONTEND_DIST / "assets"

if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def serve_frontend(path: str) -> FileResponse:
    """Serve a static file or fall back to the SPA entry point."""
    requested_file = (FRONTEND_DIST / path).resolve()
    if (
        requested_file.is_relative_to(FRONTEND_DIST.resolve())
        and requested_file.is_file()
    ):
        return FileResponse(requested_file)

    index_file = FRONTEND_DIST / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)

    raise HTTPException(
        status_code=503,
        detail="Frontend build not found. Run `npm run build` in frontend/.",
    )
