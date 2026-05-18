"""Tests for the run management endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import jwt
from httpx import AsyncClient
from app.api.v1.runs import _is_pdf_eligible


def _auth_headers(user_id: str) -> dict[str, str]:
    token = jwt.encode({"sub": user_id}, "test-secret", algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


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
    assert data["thread_id"] == data["run_id"]
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
    assert "thread_id" in data


@pytest.mark.asyncio
async def test_create_run_missing_query(async_client: AsyncClient) -> None:
    """POST /v1/runs without a query should return 422."""
    response = await async_client.post("/v1/runs", json={})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_submit_steering_while_running(async_client: AsyncClient) -> None:
    """POST /v1/runs/{run_id}/steering should queue user steering for active runs."""
    with patch("app.api.v1.runs._run_orchestrator", new_callable=AsyncMock) as mock_orch:
        mock_orch.return_value = None
        create_resp = await async_client.post(
            "/v1/runs",
            json={"query": "Track EV battery supply chain risks"},
        )

    run_id = create_resp.json()["run_id"]
    steer_resp = await async_client.post(
        f"/v1/runs/{run_id}/steering",
        json={"message": "Prioritize US and India policy updates from 2024 onward."},
    )

    assert steer_resp.status_code == 200
    body = steer_resp.json()
    assert body["queued"] is True
    assert "queued" in body["message"].lower()


@pytest.mark.asyncio
async def test_submit_steering_run_not_found(async_client: AsyncClient) -> None:
    """POST /v1/runs/{run_id}/steering returns 404 for unknown runs."""
    response = await async_client.post(
        "/v1/runs/00000000-0000-0000-0000-000000000000/steering",
        json={"message": "Use only peer-reviewed sources."},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_anonymous_runs_are_scoped_by_session(async_client: AsyncClient) -> None:
    with patch("app.api.v1.runs._run_orchestrator", new_callable=AsyncMock) as mock_orch:
        mock_orch.return_value = None
        create_resp = await async_client.post(
            "/v1/runs",
            json={"query": "Keep this anonymous thread private"},
        )

    run_id = create_resp.json()["run_id"]
    other_session = AsyncClient(
        transport=async_client._transport,
        base_url="http://testserver",
        headers={"X-Anonymous-Session-ID": "anon-other-session"},
    )
    async with other_session:
        get_resp = await other_session.get(f"/v1/runs/{run_id}")
        thread_resp = await other_session.get(f"/v1/runs/thread/{create_resp.json()['thread_id']}")

    assert get_resp.status_code == 404
    assert thread_resp.status_code == 200
    assert thread_resp.json() == []


@pytest.mark.asyncio
async def test_signed_in_user_cannot_access_other_users_run(async_client: AsyncClient) -> None:
    with patch("app.api.v1.runs._run_orchestrator", new_callable=AsyncMock) as mock_orch:
        mock_orch.return_value = None
        create_resp = await async_client.post(
            "/v1/runs",
            json={"query": "User scoped run"},
            headers=_auth_headers("user_a"),
        )

    run_id = create_resp.json()["run_id"]
    other_user_resp = await async_client.get(
        f"/v1/runs/{run_id}",
        headers=_auth_headers("user_b"),
    )
    own_user_resp = await async_client.get(
        f"/v1/runs/{run_id}",
        headers=_auth_headers("user_a"),
    )

    assert other_user_resp.status_code == 404
    assert own_user_resp.status_code == 200


@pytest.mark.asyncio
async def test_follow_up_run_reuses_thread_id(async_client: AsyncClient) -> None:
    with patch("app.api.v1.runs._run_orchestrator", new_callable=AsyncMock) as mock_orch:
        mock_orch.return_value = None
        first = await async_client.post(
            "/v1/runs",
            json={"query": "First thread turn"},
        )
        thread_id = first.json()["thread_id"]
        second = await async_client.post(
            "/v1/runs",
            json={"query": "Second thread turn", "thread_id": thread_id},
        )

    assert second.status_code == 200
    assert second.json()["thread_id"] == thread_id


def test_pdf_eligibility_rejects_short_chat_output() -> None:
    """PDF export should stay disabled for short conversational responses."""
    assert _is_pdf_eligible(
        report_md="Hi! How can I help you today?",
        citations=[],
        gate_route="CHAT_ONLY",
    ) is False


def test_pdf_eligibility_accepts_detailed_research_output() -> None:
    """PDF export should be enabled for long, structured, citation-backed reports."""
    report = (
        "## Overview\n"
        + ("This is a detailed research paragraph with findings and context. " * 20)
        + "\n## Key Findings\n"
        + ("Additional analysis and evidence synthesis. " * 20)
    )
    citations = [
        {"id": "1", "url": "https://example.com/1", "claim_text": "a", "snippet": "b"},
        {"id": "2", "url": "https://example.com/2", "claim_text": "a", "snippet": "b"},
    ]
    assert _is_pdf_eligible(
        report_md=report,
        citations=citations,
        gate_route="FULL_RESEARCH",
    ) is True
