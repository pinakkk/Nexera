"""Run management endpoints with SSE streaming support."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.db.database import async_session_factory, get_db_session
from app.db.models import Run, RunEvent
from app.schemas.runs import RunConstraints, RunResult, RunStatus, CitationOut
from app.schemas.events import RunEventResponse
from app.api.v1.health import increment_counter, decrement_counter
from app.services.event_bus import (
    register_queue,
    unregister_queue,
    broadcast_event,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs")


# ---------------------------------------------------------------------------
# Request / response schemas unique to this module
# ---------------------------------------------------------------------------


class RunCreateRequest(BaseModel):
    """Request body for creating a new research run."""

    query: str = Field(..., min_length=1, max_length=2000)
    constraints: RunConstraints | None = None
    mode: str = Field(
        default="auto",
        description="Run mode: 'auto', 'quick', or 'deep'.",
    )


class RunCreateResponse(BaseModel):
    """Response returned immediately after creating a run."""

    run_id: str
    status: str


# ---------------------------------------------------------------------------
# Background orchestrator helpers
# ---------------------------------------------------------------------------


async def _run_orchestrator(
    run_id: str,
    query: str,
    constraints: dict[str, Any] | None,
    mode: str,
) -> None:
    """Launch the orchestrator in the background with its own DB session.

    This function is decoupled from the request lifecycle and manages its
    own session so that it can outlive the originating HTTP request.
    """
    from app.services.orchestrator import Orchestrator
    from app.config import get_settings

    session = async_session_factory()
    try:
        increment_counter("active_runs")
        settings = get_settings()

        # Map the ``mode`` parameter to the ``depth`` constraint
        merged_constraints = constraints or {}
        if mode != "auto":
            merged_constraints.setdefault("depth", mode)

        orchestrator = Orchestrator(db_session=session, settings=settings)

        async def event_cb(state: str, message: str, payload: dict[str, Any]) -> None:
            """SSE callback – broadcast events to connected clients."""
            await broadcast_event(run_id, {
                "run_id": run_id,
                "state": state,
                "message": message,
                "payload": payload,
            })

        result = await orchestrator.run(
            run_id=uuid.UUID(run_id),
            query=query,
            constraints=merged_constraints,
            event_callback=event_cb,
        )

        if result.get("status") == "completed":
            increment_counter("completed_runs")
        else:
            increment_counter("failed_runs")

    except Exception as exc:
        logger.exception("Orchestrator failed for run %s", run_id)
        increment_counter("failed_runs")

        # Mark run as failed in the DB
        try:
            stmt = select(Run).where(Run.id == uuid.UUID(run_id))
            row = (await session.execute(stmt)).scalar_one_or_none()
            if row is not None:
                row.status = "failed"
                row.finished_at = datetime.now(timezone.utc)

            failure_event = RunEvent(
                id=uuid.uuid4(),
                run_id=uuid.UUID(run_id),
                timestamp=datetime.now(timezone.utc),
                state="failed",
                message=f"Run failed before completion: {exc}",
                payload_json={"error": str(exc)},
            )
            session.add(failure_event)
            await session.commit()
        except Exception:
            logger.exception("Failed to mark run %s as failed", run_id)

        await broadcast_event(run_id, {
            "run_id": run_id,
            "state": "failed",
            "message": f"Run failed before completion: {exc}",
            "payload": {"error": str(exc)},
        })

    finally:
        decrement_counter("active_runs")
        await session.close()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("", response_model=RunCreateResponse)
async def create_run(
    body: RunCreateRequest,
    db: AsyncSession = Depends(get_db_session),
) -> RunCreateResponse:
    """Create a new research run and launch the orchestrator in the background."""
    run_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    run = Run(
        id=run_id,
        query=body.query,
        constraints_json=body.constraints.model_dump() if body.constraints else None,
        status="pending",
        created_at=now,
        model_name=(body.constraints.initial_model if body.constraints else None),
    )
    db.add(run)
    await db.commit()

    increment_counter("total_runs")

    asyncio.create_task(
        _run_orchestrator(
            run_id=str(run_id),
            query=body.query,
            constraints=body.constraints.model_dump() if body.constraints else None,
            mode=body.mode,
        )
    )

    return RunCreateResponse(run_id=str(run_id), status="pending")


@router.get("/{run_id}", response_model=RunResult)
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> RunResult:
    """Return full run details including the report if completed."""
    try:
        parsed_id = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Run not found")

    stmt = select(Run).where(Run.id == parsed_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")

    return RunResult(
        id=row.id,
        query=row.query,
        status=row.status,
        created_at=row.created_at,
        finished_at=row.finished_at,
        iteration_count=row.iteration_count,
        model_name=row.model_name,
        report_md=row.report_md,
        report_json=row.report_json,
        scores=row.scores_json,
        citations=(
            [CitationOut.model_validate(c) for c in row.citations]
            if row.citations
            else None
        ),
    )


@router.get("/{run_id}/events", response_model=list[RunEventResponse])
async def get_run_events(
    run_id: str,
    state: str | None = Query(default=None, description="Filter events by state"),
    db: AsyncSession = Depends(get_db_session),
) -> list[RunEventResponse]:
    """Return the event log for a run, optionally filtered by state."""
    try:
        parsed_id = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Run not found")

    # Verify run exists
    run_stmt = select(Run.id).where(Run.id == parsed_id)
    if (await db.execute(run_stmt)).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Run not found")

    stmt = (
        select(RunEvent)
        .where(RunEvent.run_id == parsed_id)
        .order_by(RunEvent.timestamp)
    )
    if state is not None:
        stmt = stmt.where(RunEvent.state == state)

    rows = (await db.execute(stmt)).scalars().all()

    return [
        RunEventResponse(
            id=row.id,
            run_id=row.run_id,
            timestamp=row.timestamp,
            state=row.state,
            message=row.message,
            payload=row.payload_json if row.payload_json else None,
        )
        for row in rows
    ]


@router.get("/{run_id}/stream")
async def stream_run_events(
    run_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> EventSourceResponse:
    """SSE endpoint that streams run events in real time.

    Uses an asyncio.Queue per connection.  The orchestrator's event callback
    pushes events via ``broadcast_event`` to all queues registered for the
    run.  When the run reaches a terminal state (``finalize`` or ``failed``),
    a final event is sent and the stream is closed.
    """
    try:
        parsed_id = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Run not found")

    stmt = select(Run).where(Run.id == parsed_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")

    # If the run is already finished, return one terminal event immediately.
    if row.status in ("completed", "failed"):
        terminal_state = "finalize" if row.status == "completed" else "failed"

        async def _finished_generator():
            yield {
                "event": "message",
                "data": json.dumps({
                    "run_id": run_id,
                    "state": terminal_state,
                    "message": f"Run already {row.status}",
                    "payload": {"message": f"Run already {row.status}"},
                }),
            }

        return EventSourceResponse(_finished_generator())

    queue = register_queue(run_id)

    async def _event_generator():
        try:
            while True:
                try:
                    event_data = await asyncio.wait_for(queue.get(), timeout=60.0)
                except asyncio.TimeoutError:
                    # Send a keep-alive comment to prevent proxy/client timeout
                    yield {"event": "ping", "data": ""}
                    continue

                # None signals stream end (from broadcast_complete)
                if event_data is None:
                    break

                yield {
                    "event": "message",
                    "data": json.dumps(event_data, default=str),
                }

                # Close the stream when the run reaches a terminal state
                if event_data.get("state") in ("finalize", "failed"):
                    break
        except asyncio.CancelledError:
            logger.debug("SSE client disconnected for run %s", run_id)
        finally:
            unregister_queue(run_id, queue)

    return EventSourceResponse(_event_generator())


@router.get("", response_model=list[RunStatus])
async def list_runs(
    limit: int = Query(default=20, ge=1, le=100, description="Max runs to return"),
    offset: int = Query(default=0, ge=0, description="Runs to skip"),
    db: AsyncSession = Depends(get_db_session),
) -> list[RunStatus]:
    """List recent runs with pagination."""
    stmt = (
        select(Run)
        .order_by(Run.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [RunStatus.model_validate(row) for row in rows]
