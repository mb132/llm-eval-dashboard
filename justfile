set dotenv-load

# List available tasks.
default:
    @just --list

# Install dependencies and apply pending database migrations.
setup:
    uv sync
    npm --prefix frontend ci
    just db-upgrade

# Start the backend and frontend development servers.
dev: db-upgrade
    just _dev-services

# Start only the FastAPI development server on port 8000.
dev-backend:
    uv run uvicorn backend.app.main:app --reload --env-file .env

# Start only the Vite development server on port 5173.
dev-frontend:
    npm --prefix frontend run dev

[parallel]
[private]
_dev-services: dev-backend dev-frontend

# Run all backend and frontend tests.
[parallel]
test: test-backend test-frontend

# Run the backend test suite.
test-backend:
    uv run pytest

# Run the frontend test suite.
test-frontend:
    npm --prefix frontend run test

# Run only the database migration tests.
test-migrations:
    uv run pytest backend/tests/test_migrations.py

# Run all lint, formatting, type, and migration checks.
[parallel]
check: lint-python format-check typecheck-python lint-frontend db-check

# Lint the Python code.
lint-python:
    uv run ruff check .

# Check Python formatting without modifying files.
format-check:
    uv run ruff format --check .

# Type-check the Python backend.
typecheck-python:
    uv run ty check

# Type-check the TypeScript frontend.
lint-frontend:
    npm --prefix frontend run lint

# Format the Python code.
format:
    uv run ruff format .

# Build the production frontend.
build:
    npm --prefix frontend run build

# Apply all pending database migrations.
db-upgrade:
    uv run alembic upgrade head

# Check whether model changes require a database migration.
db-check:
    uv run alembic check

# Generate a database migration with the provided message.
db-revision MESSAGE:
    uv run alembic revision --autogenerate -m "{{ MESSAGE }}"

# Build and start the application with Docker Compose.
docker-up:
    docker compose up --build

# Stop the Docker Compose application without deleting volumes.
docker-down:
    docker compose down
