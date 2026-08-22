# LLM Evaluation Platform

Minimal end-to-end evaluation flow using FastAPI, React, and a local Ollama
model. The application also manages versioned prompt templates persisted in
SQLite. Install and start Ollama separately, then make the model available:

```bash
ollama run gemma4:e4b
```

## Develop

Run in two terminals:

```bash
# Frontend — http://localhost:5173
cd frontend
npm install
npm run dev
```

```bash
# Backend — http://localhost:8000
uv sync
uv run alembic upgrade head
uv run fastapi dev backend/app/main.py
```

Run `alembic upgrade head` after pulling changes that contain a new database
migration. The default SQLite database is `llm_eval.db` in the repository root;
database files are ignored by Git.

The backend defaults to `http://localhost:11434` and `gemma4:e4b`. Override
either value when needed:

```bash
OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=gemma4:e4b uv run fastapi dev backend/app/main.py
```

Prompt management is available at <http://localhost:5173/prompts>. Prompt
content must contain `{{input}}` exactly once. Editing content creates an
immutable new version; existing versions remain available.

## Database migrations

SQLAlchemy defines the database models and Alembic versions schema changes. Do
not edit an already applied migration to represent a new schema change.

After changing a model, generate and review a migration before applying it:

```bash
uv run alembic revision --autogenerate -m "describe the schema change"
uv run alembic upgrade head
uv run alembic check
```

Review generated migrations for constraints, data preservation, downgrade
behavior, and SQLite compatibility. `alembic check` verifies that model changes
are represented by migrations.

Test the complete migration lifecycle separately:

```bash
uv run pytest backend/tests/test_migrations.py
```

The test uses a disposable SQLite database, upgrades to `head`, downgrades to
`base`, and upgrades to `head` again. It does not modify `llm_eval.db`.

## Build locally

```bash
cd frontend
npm run build
cd ..
uv run fastapi dev backend/app/main.py
```

Open <http://localhost:8000>.

## Start with Docker

```bash
docker compose up --build
```

The container applies pending Alembic migrations before starting FastAPI. SQLite
data is stored in the named `app-data` volume and survives container replacement.

Docker Compose defaults `OLLAMA_BASE_URL` to
`http://host.docker.internal:11434` so the container can reach Ollama on the
host. Set the environment variable before starting Compose to use another URL.

Open <http://localhost:8000>.

## Documentation

Automatically generated FastAPI-Documentation can be found here: <http://localhost:8000/docs>