"""Health and metrics endpoints."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory counters -- updated by the runs module on state transitions
# ---------------------------------------------------------------------------
_counters: dict[str, int] = {
    "total_runs": 0,
    "active_runs": 0,
    "completed_runs": 0,
    "failed_runs": 0,
}


def increment_counter(name: str, delta: int = 1) -> None:
    """Increment a named counter by *delta*."""
    _counters[name] = _counters.get(name, 0) + delta


def decrement_counter(name: str, delta: int = 1) -> None:
    """Decrement a named counter by *delta* (floor at 0)."""
    _counters[name] = max(_counters.get(name, 0) - delta, 0)


def get_counters() -> dict[str, int]:
    """Return a snapshot of all counters."""
    return dict(_counters)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    timestamp: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Basic liveness check."""
    return HealthResponse(
        status="ok",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/metrics", response_class=PlainTextResponse)
async def metrics() -> str:
    """Return Prometheus-style plain-text metrics."""
    lines: list[str] = []
    for key, value in _counters.items():
        lines.append(f"research_agent_{key} {value}")
    return "\n".join(lines) + "\n"
