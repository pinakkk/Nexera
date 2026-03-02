"""FastAPI application entry-point.

Creates the app, registers middleware, exception handlers, and routers.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import get_settings
from app.db.database import create_all_tables
from app.services.integrations import log_api_integration_status

# ---------------------------------------------------------------------------
# Rate limiter (uses client IP by default)
# ---------------------------------------------------------------------------
limiter = Limiter(key_func=get_remote_address)

# ---------------------------------------------------------------------------
# Lifespan: startup / shutdown hooks
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan handler.

    * On startup  -- ensure all DB tables exist (dev convenience; use Alembic in prod).
    * On shutdown -- nothing special for now.
    """
    # Import models so that Base.metadata knows about every table.
    import app.db.models  # noqa: F401

    await create_all_tables()
    settings = get_settings()
    if settings.INTEGRATION_CHECK_ON_STARTUP:
        await log_api_integration_status(settings)
    yield


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    """Build and return the configured FastAPI application."""
    settings = get_settings()

    application = FastAPI(
        title="Research Agent API",
        version="0.1.0",
        description="Autonomous deep-research agent with iterative retrieval, "
        "synthesis, and citation-backed report generation.",
        lifespan=lifespan,
    )

    # ── Rate limiting ────────────────────────────────────────────────────
    application.state.limiter = limiter

    @application.exception_handler(RateLimitExceeded)
    async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": "Rate limit exceeded. Please slow down."},
        )

    # ── CORS ─────────────────────────────────────────────────────────────
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Request-ID middleware ────────────────────────────────────────────
    @application.middleware("http")
    async def add_request_id(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    # ── Global exception handlers ────────────────────────────────────────
    @application.exception_handler(ValueError)
    async def _value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": str(exc)},
        )

    @application.exception_handler(Exception)
    async def _generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error."},
        )

    # ── Routers ──────────────────────────────────────────────────────────
    _register_routers(application)

    return application


def _register_routers(application: FastAPI) -> None:
    """Import and include all API routers.

    The v1 router is mounted at ``/v1`` and the health router is mounted at
    the root level so that ``/health`` and ``/metrics`` are accessible
    without a version prefix.
    """
    try:
        from app.api.v1 import router as v1_router, health_router

        application.include_router(v1_router, prefix="/v1")
        application.include_router(health_router)
    except (ImportError, AttributeError):
        # During initial scaffolding the router module may not exist yet.
        pass


# Create the singleton app instance used by uvicorn.
app: FastAPI = create_app()
