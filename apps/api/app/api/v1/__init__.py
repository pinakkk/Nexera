"""API v1 router aggregating all sub-routers."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.runs import router as runs_router
from app.api.v1.sources import router as sources_router
from app.api.v1.health import router as health_router
from app.api.v1.models import router as models_router

# ``router`` is mounted at ``/v1`` by main.py, so sub-router prefixes
# like ``/runs`` and ``/sources`` become ``/v1/runs`` and ``/v1/sources``.
router = APIRouter()
router.include_router(runs_router, tags=["runs"])
router.include_router(sources_router, tags=["sources"])
router.include_router(models_router, tags=["models"])

# Health router is exported separately so the main application can mount
# it at the root level (``GET /health``, ``GET /metrics``).
__all__ = ["router", "health_router"]
