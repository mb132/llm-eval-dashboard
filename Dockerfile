# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.11.26 AS uv

FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app

COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-editable

COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY backend/ ./backend/
COPY docker/entrypoint.sh ./docker/entrypoint.sh
COPY --from=frontend-build /app/frontend/dist/ ./frontend/dist/

EXPOSE 8000
CMD ["sh", "docker/entrypoint.sh"]
