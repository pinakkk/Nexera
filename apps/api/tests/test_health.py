"""Tests for the health and metrics endpoints."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok(async_client: AsyncClient) -> None:
    """GET /health returns 200 with status 'ok'."""
    response = await async_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_metrics_returns_200(async_client: AsyncClient) -> None:
    """GET /metrics returns 200 with Prometheus-style counter text."""
    response = await async_client.get("/metrics")
    assert response.status_code == 200
    body = response.text
    assert "research_agent_total_runs" in body
    assert "research_agent_active_runs" in body
    assert "research_agent_completed_runs" in body
    assert "research_agent_failed_runs" in body
