.PHONY: dev dev-api dev-web dev-web-local check-db check-keys lint lint-api lint-web test test-api test-web migrate migration clean help setup-spacy

API_PY := apps/api/.venv/bin/python
API_VENV_MSG := Missing apps/api/.venv/bin/python. Create the API venv with Python 3.11 before running this target.

# =============================================================================
# Development (local — no Docker)
# =============================================================================

## Start both API and frontend concurrently
dev:
	@echo "Starting API (port 8000) and Web (port 3000)..."
	@make -j2 dev-api dev-web

## Start the FastAPI backend locally (requires virtualenv)
dev-api:
	@if [ ! -x "$(API_PY)" ]; then echo "$(API_VENV_MSG)"; exit 1; fi
	cd apps/api && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

## Start the Next.js frontend locally
dev-web:
	cd apps/web && npm run dev

## Start the Next.js frontend against local API URL
dev-web-local:
	cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev

## Validate Supabase Postgres connectivity
check-db:
	@if [ ! -x "$(API_PY)" ]; then echo "$(API_VENV_MSG)"; exit 1; fi
	cd apps/api && .venv/bin/python -m scripts.check_db

## Validate API keys (Groq + search provider)
check-keys:
	@if [ ! -x "$(API_PY)" ]; then echo "$(API_VENV_MSG)"; exit 1; fi
	cd apps/api && .venv/bin/python scripts/check_integrations.py

# =============================================================================
# Setup
# =============================================================================

## Download the spaCy model for Knowledge Graph entity extraction
setup-spacy:
	@if [ ! -x "$(API_PY)" ]; then echo "$(API_VENV_MSG)"; exit 1; fi
	cd apps/api && .venv/bin/python -m spacy download en_core_web_sm

# =============================================================================
# Linting
# =============================================================================

## Lint all projects
lint: lint-api lint-web

## Lint the Python backend with ruff
lint-api:
	cd apps/api && ruff check . && ruff format --check .

## Lint the Next.js frontend with ESLint
lint-web:
	cd apps/web && npm run lint

# =============================================================================
# Testing
# =============================================================================

## Run all tests
test: test-api test-web

## Run backend tests with pytest
test-api:
	@if [ ! -x "$(API_PY)" ]; then echo "$(API_VENV_MSG)"; exit 1; fi
	cd apps/api && .venv/bin/python -m pytest tests/ -v

## Run frontend tests
test-web:
	cd apps/web && npm test

# =============================================================================
# Database
# =============================================================================

## Apply Alembic migrations to Supabase
migrate:
	@if [ ! -x "$(API_PY)" ]; then echo "$(API_VENV_MSG)"; exit 1; fi
	cd apps/api && .venv/bin/alembic upgrade head

## Generate a new Alembic revision from the SQLAlchemy models
## (NOTE: migration files are gitignored — do not commit them)
migration:
	@if [ ! -x "$(API_PY)" ]; then echo "$(API_VENV_MSG)"; exit 1; fi
	cd apps/api && .venv/bin/alembic revision --autogenerate -m "$(m)"

# =============================================================================
# Cleanup
# =============================================================================

## Remove build artifacts and caches
clean:
	find apps -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find apps -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	rm -rf apps/web/.next apps/web/tsconfig.tsbuildinfo
	@echo "Cleaned build artifacts"

# =============================================================================
# Help
# =============================================================================

## Show this help message
help:
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  dev           Start API + Web concurrently (local)"
	@echo "  dev-api       Start the FastAPI backend locally"
	@echo "  dev-web       Start the Next.js frontend locally"
	@echo "  dev-web-local Start Next.js frontend against localhost API"
	@echo "  check-db      Validate Supabase Postgres connectivity"
	@echo "  check-keys    Validate API keys"
	@echo "  setup-spacy   Download spaCy model for KG extraction"
	@echo "  lint          Lint all projects"
	@echo "  lint-api      Lint the Python backend"
	@echo "  lint-web      Lint the Next.js frontend"
	@echo "  test          Run all tests"
	@echo "  test-api      Run backend tests"
	@echo "  test-web      Run frontend tests"
	@echo "  migrate       Apply Alembic migrations to Supabase"
	@echo "  migration     Generate a new Alembic revision (m=msg; gitignored)"
	@echo "  clean         Remove build artifacts and caches"
	@echo "  help          Show this help message"
	@echo ""
