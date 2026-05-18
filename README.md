# Autonomous Research Agent

An AI-powered research agent that autonomously searches the web, synthesizes information, and produces structured research reports. Provide a query and the agent iteratively gathers, ranks, and summarizes evidence using LLM reasoning and real-time web search.

## Architecture

The project is organized as a monorepo with three packages. The **FastAPI backend** (`apps/api`) exposes a REST API that orchestrates the research pipeline: it accepts a research query, fans out web searches via the Tavily API, fetches and parses page content, optionally reranks results with Cohere, and runs multi-step LLM reasoning through Groq-hosted Llama models.

The **Next.js frontend** (`apps/web`) provides a clean interface for submitting research queries, monitoring agent progress in real time, and browsing completed reports. The web app talks only to the FastAPI API — it has no direct database access.

Local development runs API + web directly, while database storage is externalized to **Supabase** (managed Postgres + pgvector). See [V2 architecture.md](V2%20architecture.md) for the full design.

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/pinakkk/Nexara.git
cd Nexara

# 2. Copy the example environment file and fill in your API keys
cp .env.example .env

# 3. Start all services
make dev
```

The frontend will be available at `http://localhost:3000` and the API at `http://localhost:8000`.

The API targets Python 3.11 and the repo now expects the virtualenv at `apps/api/.venv`.
Commands such as `make dev-api`, `make test-api`, and `npm run api` intentionally fail fast
if that interpreter is missing so the project does not silently run on Python 3.14.

## Local Dev Without Docker (Recommended)

Use this flow to run everything with `npm` + Python directly against MongoDB Atlas:

```bash
# 1) API
cd apps/api
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
make check-db
.venv/bin/python -m uvicorn app.main:app --reload --port 8000

# 2) In another terminal, Web
cd /path/to/Autonomous-Research-Agent
cd apps/web
npm install
cd ../..
make dev-web-local
```

This avoids local DB dependencies while you iterate on Vercel deployment. The
database is hosted on Supabase; no local Postgres is required.
Use Python 3.11 for the API environment to avoid native-wheel build issues on Python 3.14.

## Environment Variables

| Variable | Description | Required | Default |
|---|---|---|---|
| `GROQ_API_KEY` | Groq API key for LLM inference | Yes | -- |
| `GROQ_FAST_MODEL` | Fast model for lightweight tasks | No | `llama-3.1-8b-instant` |
| `GROQ_SMART_MODEL` | Capable model for reasoning tasks | No | `llama-3.3-70b-versatile` |
| `TAVILY_API_KEY` | Tavily API key for web search | Yes | -- |
| `SEARCH_MAX_RESULTS` | Max search results per query | No | `5` |
| `DATABASE_URL` | Supabase Postgres connection string (async SQLAlchemy) | Yes | -- |
| `ALLOW_START_WITHOUT_DB` | Skip startup Supabase readiness check (not recommended) | No | `false` |
| `REDIS_URL` | Redis connection string | No | -- |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | No | `http://localhost:3000,http://localhost:3001` |
| `RATE_LIMIT_PER_MINUTE` | General API rate limit | No | `30` |
| `RATE_LIMIT_RUNS_PER_MINUTE` | Research run rate limit | No | `5` |
| `MAX_ITERATIONS` | Max agent reasoning iterations | No | `3` |
| `FETCH_TIMEOUT_SECONDS` | Timeout for fetching web pages | No | `15` |
| `COHERE_API_KEY` | Cohere API key for reranking | No | -- |
| `NEXT_PUBLIC_API_URL` | API URL exposed to the browser | Yes | `http://localhost:8000` |

## Development Commands

```bash
make dev          # Start API + Web concurrently (local)
make dev-api      # Start the FastAPI backend locally
make dev-web      # Start the Next.js frontend locally
make dev-web-local # Start frontend pointed at http://localhost:8000
make check-db     # Validate Supabase Postgres connectivity
make lint         # Lint both backend and frontend
make test         # Run all tests
make migrate      # Apply Alembic migrations to Supabase
make migration    # Generate a new Alembic revision from the models
make clean        # Remove build artifacts and caches
make help         # Show all available targets
```

> **Open source note:** this repo is public. Alembic migration files under
> `apps/api/alembic/versions/` are **gitignored** and must not be committed —
> contributors generate them locally from the SQLAlchemy models with
> `make migration`. Only `.env.example` (placeholders) is tracked.

## Supabase Connectivity Troubleshooting

If DB health checks fail:

```bash
# 1) Validate Supabase connectivity from current env
make check-db

# 2) Confirm DATABASE_URL points at your Supabase project
#    (Project Settings → Database → Connection string → URI)

# 3) Check that your IP / network is allowed in Supabase
#    (Project Settings → Database → Network restrictions)
```

If connection still fails, regenerate the Supabase connection string and update `apps/api/.env`.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/runs` | Start a new research run |
| `GET` | `/v1/runs/{run_id}` | Get status and result of a run |
| `GET` | `/v1/runs/{run_id}/events` | Get persisted run events |
| `GET` | `/v1/runs/{run_id}/stream` | Stream live run events (SSE) |
| `GET` | `/v1/runs` | List research runs |
| `GET` | `/health` | Health check |
| `GET` | `/docs` | Interactive Swagger documentation |

## Tech Stack

- **Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend:** Python 3.11+, FastAPI, Pydantic, SQLAlchemy 2.0, Alembic
- **LLM:** Groq API (Llama 3.1 / 3.3)
- **Search:** Tavily Search API
- **Reranking:** Cohere Rerank (optional)
- **Database:** Supabase (managed Postgres + pgvector), Alembic migrations
- **Cache/Rate Limiting:** Redis 7
- **Infrastructure:** Local process workflow, Supabase
- **Linting:** Ruff (Python), ESLint (TypeScript)
- **Testing:** pytest (Python), Jest (TypeScript)
