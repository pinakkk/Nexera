.PHONY: dev dev-api dev-web dev-web-local check-neon check-keys lint lint-api lint-web test test-api test-web migrate clean help

# =============================================================================
# Development
# =============================================================================

## Start all services via Docker Compose
dev:
	docker-compose up --build

## Start the FastAPI backend locally (requires virtualenv)
dev-api:
	cd apps/api && if [ -x .venv/bin/python ]; then .venv/bin/python -m uvicorn app.main:app --reload --port 8000; else python3 -m uvicorn app.main:app --reload --port 8000; fi

## Start the Next.js frontend locally
dev-web:
	cd apps/web && npm run dev

## Start the Next.js frontend against local API URL
dev-web-local:
	cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev

## Validate Neon DNS/TCP/SQL connectivity from apps/api/.env
check-neon:
	cd apps/api && if [ -x .venv/bin/python ]; then .venv/bin/python scripts/check_neon.py; else python3 scripts/check_neon.py; fi

## Validate Groq + Tavily API keys from apps/api/.env
check-keys:
	cd apps/api && if [ -x .venv/bin/python ]; then .venv/bin/python scripts/check_integrations.py; else python3 scripts/check_integrations.py; fi

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
	cd apps/api && python3 -m pytest tests/ -v

## Run frontend tests
test-web:
	cd apps/web && npm test

# =============================================================================
# Database
# =============================================================================

## Run Alembic database migrations
migrate:
	cd apps/api && alembic upgrade head

## Create a new Alembic migration (usage: make migration msg="description")
migration:
	cd apps/api && alembic revision --autogenerate -m "$(msg)"

# =============================================================================
# Cleanup
# =============================================================================

## Stop all containers and remove volumes
clean:
	docker-compose down -v

# =============================================================================
# Help
# =============================================================================

## Show this help message
help:
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  dev           Start all services via Docker Compose"
	@echo "  dev-api       Start the FastAPI backend locally"
	@echo "  dev-web       Start the Next.js frontend locally"
	@echo "  dev-web-local Start Next.js frontend against localhost API"
	@echo "  check-neon    Validate Neon DNS/TCP/SQL connectivity"
	@echo "  check-keys    Validate Groq + Tavily API keys"
	@echo "  lint          Lint all projects"
	@echo "  lint-api      Lint the Python backend"
	@echo "  lint-web      Lint the Next.js frontend"
	@echo "  test          Run all tests"
	@echo "  test-api      Run backend tests"
	@echo "  test-web      Run frontend tests"
	@echo "  migrate       Run database migrations"
	@echo "  migration     Create a new migration (msg=...)"
	@echo "  clean         Stop containers and remove volumes"
	@echo "  help          Show this help message"
	@echo ""
