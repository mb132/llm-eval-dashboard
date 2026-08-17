# LLM Evaluation Platform

Minimal end-to-end evaluation flow using FastAPI, React, and a local Ollama
model. Install and start Ollama separately, then make the model available:

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
uv run fastapi dev backend/app/main.py
```

The backend defaults to `http://localhost:11434` and `gemma4:e4b`. Override
either value when needed:

```bash
OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_MODEL=gemma4:e4b uv run fastapi dev backend/app/main.py
```

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

Docker Compose defaults `OLLAMA_BASE_URL` to
`http://host.docker.internal:11434` so the container can reach Ollama on the
host. Set the environment variable before starting Compose to use another URL.

Open <http://localhost:8000>.
