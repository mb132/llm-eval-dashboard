# LLM Evaluation Platform

A local platform for running repeatable evaluations of language models. Manage
prompts and datasets, compare configured models, and inspect responses, quality,
latency, token usage, estimated cost, and security checks.

## Features

- Save immutable prompt versions and reusable test datasets.
- Run evaluations with Ollama, OpenAI, OpenRouter, Anthropic, Gemini, and
  OpenAI-compatible providers.
- Review run history, individual requests, model and prompt comparisons, and
  normalized exports.
- Try one-off prompts in the playground without saving them.

## Quick start

Requirements: Python 3.13+, Node.js, `uv`, and [just](https://just.systems/).
For local Ollama, install Ollama and make the default model available:

```bash
ollama run gemma4:e4b
```

Create the local environment file and generate a master key for encrypting
provider credentials:

```bash
cp .env.example .env
python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

Put the generated value in `LLM_EVAL_MASTER_KEY` in `.env`, then install and
start the application:

```bash
just setup
just dev
```

Open <http://localhost:5173>. Vite proxies API requests to FastAPI on port 8000.
FastAPI serves the built application at <http://localhost:8000>.

## Security

This application has no authentication or tenant isolation. Use it only for
trusted local or demo work; do not expose it publicly or store confidential
prompts and results on a shared instance. Keep `LLM_EVAL_MASTER_KEY` separate
from database backups. If the key is lost or changed, stored provider
credentials cannot be recovered.

## Documentation

- [Project Wiki](https://github.com/mb132/llm-eval-dashboard/wiki) — setup,
  model configuration, evaluation workflows, results, examples, and development.
- [FastAPI API reference](http://localhost:8000/docs) — available after starting
  the backend.

The repository includes [example datasets](examples/imports/) that can be
imported from the Datasets page.
