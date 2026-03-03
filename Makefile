.PHONY: dev dev-api dev-web dev-web-local check-mongo check-keys lint lint-api lint-web test test-api test-web migrate clean help setup-spacy

# =============================================================================
# Development (local — no Docker)
# =============================================================================

## Start both API and frontend concurrently
dev:
	@echo "Starting API (port 8000) and Web (port 3000)..."
	@make -j2 dev-api dev-web

## Start the FastAPI backend locally (requires virtualenv)
dev-api:
	cd apps/api && if [ -x .venv/bin/python ]; then .venv/bin/python -m uvicorn app.main:app --reload --port 8000; else python3 -m uvicorn app.main:app --reload --port 8000; fi

## Start the Next.js frontend locally
dev-web:
	cd apps/web && npm run dev

## Start the Next.js frontend against local API URL
dev-web-local:
	cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev

## Validate MongoDB Atlas connectivity via Prisma
check-mongo:
	cd apps/web && export DATABASE_URL="$$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)" && node -e 'const {PrismaClient}=require("@prisma/client"); const p=new PrismaClient(); p.$$runCommandRaw({ping:1}).then(r=>{console.log("MongoDB OK",r);}).catch(e=>{console.error("MongoDB check failed:", e.message || e); process.exit(1);}).finally(async()=>{await p.$$disconnect();});'

## Validate API keys (Groq + search provider)
check-keys:
	cd apps/api && if [ -x .venv/bin/python ]; then .venv/bin/python scripts/check_integrations.py; else python3 scripts/check_integrations.py; fi

# =============================================================================
# Setup
# =============================================================================

## Download the spaCy model for Knowledge Graph entity extraction
setup-spacy:
	cd apps/api && if [ -x .venv/bin/python ]; then .venv/bin/python -m spacy download en_core_web_sm; else python3 -m spacy download en_core_web_sm; fi

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

## Push Prisma schema changes to MongoDB Atlas
migrate:
	cd apps/web && export DATABASE_URL="$$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)" && npm run prisma:push

## Generate Prisma client
migration:
	cd apps/web && npm run prisma:generate

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
	@echo "  check-mongo   Validate MongoDB Atlas connectivity via Prisma"
	@echo "  check-keys    Validate API keys"
	@echo "  setup-spacy   Download spaCy model for KG extraction"
	@echo "  lint          Lint all projects"
	@echo "  lint-api      Lint the Python backend"
	@echo "  lint-web      Lint the Next.js frontend"
	@echo "  test          Run all tests"
	@echo "  test-api      Run backend tests"
	@echo "  test-web      Run frontend tests"
	@echo "  migrate       Push Prisma schema to MongoDB Atlas"
	@echo "  migration     Generate Prisma client"
	@echo "  clean         Remove build artifacts and caches"
	@echo "  help          Show this help message"
	@echo ""
