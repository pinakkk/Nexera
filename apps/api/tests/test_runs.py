"""Tests for the run management endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_run_returns_pending(async_client: AsyncClient) -> None:
    """POST /v1/runs should persist the run and return a run_id with pending status."""
    with patch("app.api.v1.runs._run_orchestrator", new_callable=AsyncMock) as mock_orch:
        mock_orch.return_value = None
        response = await async_client.post(
            "/v1/runs",
            json={"query": "What is quantum computing?"},
        )

    assert response.status_code == 200
    data = response.json()
    assert "run_id" in data
    assert data["status"] == "pending"
    assert len(data["run_id"]) == 36  # UUID format


@pytest.mark.asyncio
async def test_get_run_not_found(async_client: AsyncClient) -> None:
    """GET /v1/runs/{run_id} should return 404 for a non-existent run."""
    response = await async_client.get("/v1/runs/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["detail"] == "Run not found"


@pytest.mark.asyncio
async def test_list_runs_returns_list(async_client: AsyncClient) -> None:
    """GET /v1/runs should return a (possibly empty) list."""
    response = await async_client.get("/v1/runs")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_list_runs_pagination(async_client: AsyncClient) -> None:
    """GET /v1/runs supports limit and offset query params."""
    response = await async_client.get("/v1/runs", params={"limit": 5, "offset": 0})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) <= 5


@pytest.mark.asyncio
async def test_create_and_retrieve_run(async_client: AsyncClient) -> None:
    """Create a run then retrieve it by ID to verify persistence."""
    with patch("app.api.v1.runs._run_orchestrator", new_callable=AsyncMock) as mock_orch:
        mock_orch.return_value = None
        create_resp = await async_client.post(
            "/v1/runs",
            json={"query": "Explain machine learning", "mode": "auto"},
        )

    assert create_resp.status_code == 200
    run_id = create_resp.json()["run_id"]

    get_resp = await async_client.get(f"/v1/runs/{run_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == run_id
    assert data["status"] == "pending"
    assert data["query"] == "Explain machine learning"


@pytest.mark.asyncio
async def test_get_run_events_empty(async_client: AsyncClient) -> None:
    """GET /v1/runs/{run_id}/events returns an empty list for a new run."""
    with patch("app.api.v1.runs._run_orchestrator", new_callable=AsyncMock) as mock_orch:
        mock_orch.return_value = None
        create_resp = await async_client.post(
            "/v1/runs",
            json={"query": "Test events query"},
        )

    run_id = create_resp.json()["run_id"]
    events_resp = await async_client.get(f"/v1/runs/{run_id}/events")
    assert events_resp.status_code == 200
    assert events_resp.json() == []


@pytest.mark.asyncio
async def test_get_run_events_not_found(async_client: AsyncClient) -> None:
    """GET /v1/runs/{run_id}/events returns 404 for non-existent run."""
    response = await async_client.get(
        "/v1/runs/00000000-0000-0000-0000-000000000000/events"
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_run_with_constraints(async_client: AsyncClient) -> None:
    """POST /v1/runs with constraints is accepted."""
    with patch("app.api.v1.runs._run_orchestrator", new_callable=AsyncMock) as mock_orch:
        mock_orch.return_value = None
        response = await async_client.post(
            "/v1/runs",
            json={
                "query": "Compare Python and Rust",
                "constraints": {
                    "depth": "deep",
                    "allowed_domains": ["docs.python.org", "doc.rust-lang.org"],
                    "citation_style": "mla",
                },
                "mode": "deep",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_create_run_missing_query(async_client: AsyncClient) -> None:
    """POST /v1/runs without a query should return 422."""
    response = await async_client.post("/v1/runs", json={})
    assert response.status_code == 422
