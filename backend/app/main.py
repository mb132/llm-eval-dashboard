"""FastAPI application serving the production frontend."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="LLM Evaluation Platform")

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
