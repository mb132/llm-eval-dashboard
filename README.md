# LLM Evaluation Platform

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

Open <http://localhost:8000>.
