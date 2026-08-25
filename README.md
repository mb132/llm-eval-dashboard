# LLM Evaluation Platform

Persistent evaluation execution using FastAPI, React, and a local Ollama model.
The application combines immutable prompt versions with reusable test datasets,
tracks progress, stores every raw model response in SQLite, and includes
persisted model configuration plus a one-shot playground. Install and start
Ollama separately, then make the model available:

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

During development, open the React application at <http://localhost:5173>;
Vite proxies its `/api` requests to FastAPI on port `8000`. After building the
frontend or when using Docker, FastAPI serves the application on
<http://localhost:8000> instead.

Run `alembic upgrade head` after pulling changes that contain a new database
migration. The default SQLite database is `llm_eval.db` in the repository root;
database files are ignored by Git.

The backend defaults to `http://localhost:11434` and `gemma4:e4b`. Override
either value when needed:

```bash
OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=gemma4:e4b uv run fastapi dev backend/app/main.py
```

Evaluation configuration is available at <http://localhost:5173>. Its model
multi-select lists active persisted configurations with executable provider
protocols. Evaluations support selecting and comparing multiple model IDs.

After reviewing a configuration, start the evaluation from the same page. The
server persists its inputs first, processes up to four model requests in the
background, and opens a progress page that can be refreshed safely. Individual
request failures remain visible without stopping the rest of the run. This is a
local single-process worker: a server restart marks unfinished work as failed
instead of replaying requests whose provider-side outcome is unknown. Quality
scores and cost estimates are intentionally added by later features.

The application has no authentication or tenant isolation and is intended for
trusted local/demo use only. Do not expose it publicly or store confidential
prompts and results on a shared instance.

Prompt management is available at <http://localhost:5173/prompts>. Prompt
content must contain `{{input}}` exactly once. Editing content creates an
immutable new version; existing versions remain available.

Dataset management is available at <http://localhost:5173/datasets>. Creating a
dataset also creates its required first test case. Every test case requires an
input and expected answer and may include a category plus up to 20 flat metadata
fields. A dataset always retains at least one test case and is limited to 500
cases to bound later evaluation cost and resource use.

JSON and CSV dataset import are intentionally deferred. A future import feature
should reuse the same server-side validation and size limits rather than adding
a separate ingestion path.

## Tests

Run tests from the repository root. They work offline without Ollama or API
credentials:

```bash
uv run pytest                         # all backend tests
npm --prefix frontend run test        # all frontend tests
uv run pytest backend/tests/test_migrations.py  # migration tests only
```

## Code quality

Run checks from the repository root. The `--check` commands do not modify files;
`ruff format` applies the Python formatting:

```bash
uv run ruff check .                  # Python linting
uv run ruff format --check .         # check Python formatting
uv run ruff format .                 # apply Python formatting
uv run ty check                      # Python type checking
npm --prefix frontend run lint       # TypeScript type checking
```

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
are represented by migrations. The migration test uses a disposable SQLite
database and does not modify `llm_eval.db`.

## Build locally

```bash
cd frontend
npm run build
cd ..
uv run fastapi dev backend/app/main.py
```

Open <http://localhost:8000>.

## Configure models

Open the **Models** page to add Ollama, OpenAI, Anthropic, Google Gemini,
OpenAI-compatible, or custom endpoint configurations. Records are persisted in
the same Alembic-managed SQLite database (`./llm_eval.db` by default). Set
`DATABASE_URL` to use another
SQLite location.

Provider credentials remain server-side. Copy `.env.example` to `.env`, set the
required credential values, and enter only the provider's corresponding
environment variable name (for example, `OPENAI_API_KEY`) in a model
configuration. Secret values are never stored in SQLite or returned by the API.
For safety, custom base URLs cannot use server credentials; OpenAI,
Anthropic, and Gemini use their fixed official endpoints.

## Use the playground

Open the **Playground** page, select an active configured model, and send a
one-shot text prompt with an optional system prompt. The backend resolves the
configured credential only for that request and returns the reply, latency,
token usage, and finish reason. Playground prompts and replies are not stored.

Ollama, OpenAI, Anthropic, Gemini, and OpenAI-compatible configurations are
executable. Custom endpoints remain configuration-only until a request protocol
is defined for them.

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
