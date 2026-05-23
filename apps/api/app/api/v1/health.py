"""Health and metrics endpoints."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.config import get_settings

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


# ---------------------------------------------------------------------------
# Service connectivity check
# ---------------------------------------------------------------------------

PROBE_TIMEOUT_SECONDS = 5.0


class ServiceStatus(BaseModel):
    name: str
    status: str  # "ok" | "error" | "not_configured" | "skipped"
    configured: bool
    latency_ms: Optional[int] = None
    detail: Optional[str] = None


class ServicesHealthResponse(BaseModel):
    status: str  # "ok" | "degraded" | "error"
    timestamp: str
    services: list[ServiceStatus]


async def _probe_http(
    name: str,
    *,
    url: str,
    headers: Optional[dict[str, str]] = None,
    ok_statuses: tuple[int, ...] = (200,),
    configured: bool = True,
) -> ServiceStatus:
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
            res = await client.get(url, headers=headers or {})
        latency_ms = int((time.perf_counter() - started) * 1000)
        if res.status_code in ok_statuses:
            return ServiceStatus(
                name=name, status="ok", configured=configured, latency_ms=latency_ms
            )
        return ServiceStatus(
            name=name,
            status="error",
            configured=configured,
            latency_ms=latency_ms,
            detail=f"HTTP {res.status_code}",
        )
    except httpx.TimeoutException:
        return ServiceStatus(
            name=name,
            status="error",
            configured=configured,
            detail=f"timeout after {PROBE_TIMEOUT_SECONDS:.0f}s",
        )
    except Exception as exc:
        return ServiceStatus(
            name=name,
            status="error",
            configured=configured,
            detail=f"{type(exc).__name__}: {exc}".strip(),
        )


async def _check_supabase_db() -> ServiceStatus:
    settings = get_settings()
    if not settings.DATABASE_URL:
        return ServiceStatus(
            name="supabase_db",
            status="not_configured",
            configured=False,
            detail="DATABASE_URL is not set",
        )
    started = time.perf_counter()
    try:
        from app.db import get_store

        store = get_store()
        await store.ping()
        latency_ms = int((time.perf_counter() - started) * 1000)
        return ServiceStatus(
            name="supabase_db", status="ok", configured=True, latency_ms=latency_ms
        )
    except Exception as exc:
        return ServiceStatus(
            name="supabase_db",
            status="error",
            configured=True,
            detail=f"{type(exc).__name__}: {exc}".strip()[:240],
        )


async def _check_supabase_auth() -> ServiceStatus:
    settings = get_settings()
    if not settings.SUPABASE_JWT_SECRET:
        return ServiceStatus(
            name="supabase_auth",
            status="not_configured",
            configured=False,
            detail="SUPABASE_JWT_SECRET is not set; tokens cannot be verified",
        )
    return ServiceStatus(
        name="supabase_auth",
        status="ok",
        configured=True,
        detail=f"audience='{settings.SUPABASE_JWT_AUDIENCE}'",
    )


async def _check_groq() -> ServiceStatus:
    settings = get_settings()
    if not settings.GROQ_API_KEY:
        return ServiceStatus(
            name="groq",
            status="not_configured",
            configured=False,
            detail="GROQ_API_KEY is not set",
        )
    return await _probe_http(
        "groq",
        url="https://api.groq.com/openai/v1/models",
        headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
    )


async def _check_tavily() -> ServiceStatus:
    settings = get_settings()
    if not settings.TAVILY_API_KEY:
        return ServiceStatus(
            name="tavily",
            status="not_configured",
            configured=False,
            detail="TAVILY_API_KEY is not set",
        )
    # Tavily has no public GET health route; do a minimal search POST.
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
            res = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": settings.TAVILY_API_KEY,
                    "query": "ping",
                    "max_results": 1,
                },
            )
        latency_ms = int((time.perf_counter() - started) * 1000)
        if res.status_code == 200:
            return ServiceStatus(
                name="tavily", status="ok", configured=True, latency_ms=latency_ms
            )
        return ServiceStatus(
            name="tavily",
            status="error",
            configured=True,
            latency_ms=latency_ms,
            detail=f"HTTP {res.status_code}",
        )
    except Exception as exc:
        return ServiceStatus(
            name="tavily",
            status="error",
            configured=True,
            detail=f"{type(exc).__name__}: {exc}".strip()[:240],
        )


async def _check_brightdata() -> ServiceStatus:
    settings = get_settings()
    if not settings.BRIGHTDATA_API_KEY:
        return ServiceStatus(
            name="brightdata",
            status="not_configured",
            configured=False,
            detail="BRIGHTDATA_API_KEY is not set",
        )
    # Bright Data does not expose a documented health endpoint; resolving
    # the API host confirms outbound DNS / TLS reachability with the token.
    return await _probe_http(
        "brightdata",
        url="https://api.brightdata.com/status",
        headers={"Authorization": f"Bearer {settings.BRIGHTDATA_API_KEY}"},
        ok_statuses=(200, 401, 403, 404),  # any structured response = reachable
    )


async def _check_cohere() -> ServiceStatus:
    settings = get_settings()
    if not settings.COHERE_API_KEY:
        return ServiceStatus(
            name="cohere",
            status="not_configured",
            configured=False,
            detail="COHERE_API_KEY is not set",
        )
    return await _probe_http(
        "cohere",
        url="https://api.cohere.com/v1/models",
        headers={"Authorization": f"Bearer {settings.COHERE_API_KEY}"},
    )


async def _check_redis() -> ServiceStatus:
    settings = get_settings()
    if not settings.REDIS_URL:
        return ServiceStatus(
            name="redis",
            status="not_configured",
            configured=False,
            detail="REDIS_URL is not set (optional)",
        )
    started = time.perf_counter()
    try:
        # Import lazily so the package stays optional.
        from redis import asyncio as redis_async

        client = redis_async.from_url(
            settings.REDIS_URL, socket_timeout=PROBE_TIMEOUT_SECONDS
        )
        try:
            pong = await client.ping()
        finally:
            await client.close()
        latency_ms = int((time.perf_counter() - started) * 1000)
        if pong:
            return ServiceStatus(
                name="redis", status="ok", configured=True, latency_ms=latency_ms
            )
        return ServiceStatus(
            name="redis",
            status="error",
            configured=True,
            latency_ms=latency_ms,
            detail="PING returned falsy",
        )
    except Exception as exc:
        return ServiceStatus(
            name="redis",
            status="error",
            configured=True,
            detail=f"{type(exc).__name__}: {exc}".strip()[:240],
        )


@router.get("/health/services", response_model=ServicesHealthResponse)
async def services_health() -> ServicesHealthResponse:
    """Probe each configured external dependency and report reachability.

    Each probe runs with a short timeout and never raises; failures show up
    as ``status="error"`` with a ``detail`` message. Services without a
    configured API key/URL are reported as ``not_configured`` and do not
    contribute to overall degradation.
    """
    results = await asyncio.gather(
        _check_supabase_db(),
        _check_supabase_auth(),
        _check_groq(),
        _check_tavily(),
        _check_brightdata(),
        _check_cohere(),
        _check_redis(),
    )

    has_error = any(r.status == "error" and r.configured for r in results)
    overall = "error" if has_error else "ok"

    return ServicesHealthResponse(
        status=overall,
        timestamp=datetime.now(timezone.utc).isoformat(),
        services=list(results),
    )
