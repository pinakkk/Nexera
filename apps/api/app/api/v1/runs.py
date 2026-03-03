"""Run management endpoints with SSE streaming support."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.api.v1.health import decrement_counter, increment_counter
from app.db.mongo import (
    MongoStore,
    MongoUnavailableError,
    describe_mongo_error,
    get_mongo_store,
)
from app.schemas.events import RunEventResponse
from app.schemas.runs import CitationOut, RunConstraints, RunResult, RunStatus
from app.services.event_bus import broadcast_event, register_queue, unregister_queue

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs")


def _get_store_or_503() -> MongoStore:
    try:
        return get_mongo_store()
    except MongoUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


async def _db_or_503(action: str, operation: Any) -> Any:
    try:
        return await operation
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("MongoDB operation failed while trying to %s", action)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Database operation failed while attempting to {action}: "
                f"{describe_mongo_error(exc)}"
            ),
        ) from exc


def _canonical_uuid(value: str, detail: str = "Run not found") -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(status_code=404, detail=detail)


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _parse_uuid_or_new(value: Any) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return uuid.uuid4()


def _parse_citations(raw: Any) -> list[CitationOut] | None:
    if not isinstance(raw, list):
        return None

    out: list[CitationOut] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url", "")).strip()
        if not url:
            continue
        out.append(
            CitationOut(
                id=_parse_uuid_or_new(item.get("id")),
                claim_text=str(item.get("claim_text", "")),
                snippet=str(item.get("snippet", "")),
                url=url,
                section_key=(
                    str(item.get("section_key"))
                    if item.get("section_key") is not None
                    else None
                ),
            )
        )
    return out or None


def _run_result_from_doc(doc: dict[str, Any]) -> RunResult:
    return RunResult(
        id=_parse_uuid_or_new(doc.get("id")),
        query=str(doc.get("query", "")),
        status=str(doc.get("status", "pending")),
        created_at=_parse_datetime(doc.get("created_at")),
        finished_at=(
            _parse_datetime(doc.get("finished_at"))
            if doc.get("finished_at") is not None
            else None
        ),
        iteration_count=int(doc.get("iteration_count", 0)),
        model_name=(
            str(doc.get("model_name"))
            if doc.get("model_name") is not None
            else None
        ),
        report_md=(
            str(doc.get("report_md")) if doc.get("report_md") is not None else None
        ),
        report_json=(
            doc.get("report_json") if isinstance(doc.get("report_json"), dict) else None
        ),
        scores=(
            doc.get("scores_json") if isinstance(doc.get("scores_json"), dict) else None
        ),
        citations=_parse_citations(doc.get("citations")),
    )


def _run_status_from_doc(doc: dict[str, Any]) -> RunStatus:
    return RunStatus(
        id=_parse_uuid_or_new(doc.get("id")),
        query=str(doc.get("query", "")),
        status=str(doc.get("status", "pending")),
        created_at=_parse_datetime(doc.get("created_at")),
        finished_at=(
            _parse_datetime(doc.get("finished_at"))
            if doc.get("finished_at") is not None
            else None
        ),
        iteration_count=int(doc.get("iteration_count", 0)),
        model_name=(
            str(doc.get("model_name"))
            if doc.get("model_name") is not None
            else None
        ),
    )


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
    gate_result: dict[str, Any] | None = None
    pdf_url: str | None = None


class UserInputRequest(BaseModel):
    """Request body for submitting user input during a run."""

    action: str = Field(
        default="approve",
        description="Action: 'approve' or 'edit'.",
    )
    sub_questions: list[str] | None = None
    constraints: dict[str, Any] | None = None
    excluded_domains: list[str] | None = None
    focus_topics: list[str] | None = None


class UserInputResponse(BaseModel):
    """Response for user input submission."""

    accepted: bool
    message: str


# ---------------------------------------------------------------------------
# Background orchestrator helpers
# ---------------------------------------------------------------------------


async def _run_orchestrator(
    run_id: str,
    query: str,
    constraints: dict[str, Any] | None,
    mode: str,
) -> None:
    """Launch the orchestrator in the background.

    Flow:
    1. Safety guard (prompt injection check)
    2. Research gate (classify: CHAT_ONLY / DIRECT_ANSWER / LIGHT_LOOKUP / FULL_RESEARCH)
    3. For non-FULL_RESEARCH: generate quick response and finalize
    4. For FULL_RESEARCH: run full orchestrator pipeline
    """
    from app.config import get_settings
    from app.services.orchestrator import Orchestrator
    from app.services.research_gate import classify_query, generate_quick_response, FULL_RESEARCH
    from app.services.safety_guard import SafetyGuardService
    from app.services.llm import get_llm_service
    from app.services.pdf_generator import generate_pdf_from_markdown

    store: MongoStore | None = None
    try:
        store = get_mongo_store()
        increment_counter("active_runs")
        settings = get_settings()
        llm = get_llm_service(settings)

        async def event_cb(state: str, message: str, payload: dict[str, Any]) -> None:
            await broadcast_event(
                run_id,
                {
                    "run_id": run_id,
                    "state": state,
                    "message": message,
                    "payload": payload,
                },
            )

        # ── Step 1: Safety Guard ──────────────────────────────────────────
        safety = SafetyGuardService()
        safety_result = await safety.guard_prompt(query, llm)
        await event_cb("prompt_guard", f"Prompt guard: safe={safety_result['safe']}", safety_result)

        if not safety_result.get("safe", True):
            await store.update_run_final(
                run_id=run_id, status="failed",
                report_md=f"Request blocked: {safety_result.get('reason', 'safety concern')}",
                report_json={}, scores_json={}, citations=[],
                model_name=None, iteration_count=0,
            )
            await event_cb("failed", "Request blocked by safety guard", safety_result)
            increment_counter("failed_runs")
            return

        # ── Step 2: Research Gate ─────────────────────────────────────────
        gate_result = {"route": FULL_RESEARCH, "reason": "gate disabled", "signals": []}
        if getattr(settings, "RESEARCH_GATE_ENABLED", True):
            gate_result = await classify_query(query, llm)

        await event_cb(
            "research_gate",
            f"Gate decision: {gate_result['route']}",
            {"gate_result": gate_result},
        )

        # ── Step 3: Non-research routes → quick response ─────────────────
        if gate_result["route"] != FULL_RESEARCH:
            quick_response = await generate_quick_response(query, llm, gate_result["route"])
            await store.update_run_final(
                run_id=run_id, status="completed",
                report_md=quick_response,
                report_json={"gate_route": gate_result["route"]},
                scores_json={"gate": gate_result},
                citations=[], model_name=llm.fast_model, iteration_count=0,
            )
            await event_cb(
                "finalize",
                f"Quick response ({gate_result['route']})",
                {"report_md": quick_response, "gate_route": gate_result["route"]},
            )
            increment_counter("completed_runs")
            return

        # ── Step 4: FULL_RESEARCH → orchestrator pipeline ────────────────
        merged_constraints = dict(constraints or {})
        if mode != "auto":
            merged_constraints.setdefault("depth", mode)

        orchestrator = Orchestrator(
            db_session=None,
            settings=settings,
            run_store=store,
        )

        result = await orchestrator.run(
            run_id=uuid.UUID(run_id),
            query=query,
            constraints=merged_constraints,
            event_callback=event_cb,
        )

        # ── Step 5: Generate PDF if report completed ─────────────────────
        if result.get("status") == "completed" and result.get("report_md"):
            try:
                pdf_path = generate_pdf_from_markdown(
                    report_md=result["report_md"],
                    run_id=run_id,
                )
                if pdf_path:
                    await event_cb("pdf_generated", f"PDF saved: {pdf_path.name}", {"pdf_url": f"/v1/runs/{run_id}/pdf"})
            except Exception as pdf_exc:
                logger.warning("PDF generation failed for run %s: %s", run_id, pdf_exc)

            increment_counter("completed_runs")
        else:
            increment_counter("failed_runs")

    except Exception as exc:
        logger.exception("Orchestrator failed for run %s", run_id)
        increment_counter("failed_runs")
        if store is not None:
            try:
                await store.mark_run_failed(run_id)
                await store.append_event(
                    event_id=str(uuid.uuid4()),
                    run_id=run_id,
                    state="failed",
                    message=f"Run failed before completion: {exc}",
                    payload={"error": str(exc)},
                    timestamp=datetime.now(timezone.utc),
                )
            except Exception:
                logger.exception("Failed to persist failure state for run %s", run_id)
        await broadcast_event(
            run_id,
            {
                "run_id": run_id,
                "state": "failed",
                "message": f"Run failed before completion: {exc}",
                "payload": {"error": str(exc)},
            },
        )
    finally:
        decrement_counter("active_runs")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("", response_model=RunCreateResponse)
async def create_run(body: RunCreateRequest) -> RunCreateResponse:
    """Create a new research run and launch the orchestrator in the background."""
    store = _get_store_or_503()
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    constraints_json = body.constraints.model_dump() if body.constraints else None
    await _db_or_503(
        "create a run",
        store.create_run(
            {
                "id": run_id,
                "query": body.query,
                "constraints_json": constraints_json,
                "status": "pending",
                "created_at": now,
                "finished_at": None,
                "iteration_count": 0,
                "model_name": (
                    body.constraints.initial_model if body.constraints else None
                ),
                "report_md": None,
                "report_json": None,
                "scores_json": None,
                "citations": [],
            }
        ),
    )

    increment_counter("total_runs")

    asyncio.create_task(
        _run_orchestrator(
            run_id=run_id,
            query=body.query,
            constraints=constraints_json,
            mode=body.mode,
        )
    )

    return RunCreateResponse(run_id=run_id, status="pending")


@router.get("/{run_id}", response_model=RunResult)
async def get_run(run_id: str) -> RunResult:
    """Return full run details including the report if completed."""
    run_id = _canonical_uuid(run_id)
    store = _get_store_or_503()

    row = await _db_or_503("read run details", store.get_run(run_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")

    return _run_result_from_doc(row)


@router.delete("/{run_id}")
async def delete_run(run_id: str) -> dict[str, Any]:
    """Delete a research run and all associated data."""
    run_id = _canonical_uuid(run_id)
    store = _get_store_or_503()

    deleted = await _db_or_503("delete a run", store.delete_run(run_id))
    if not deleted:
        raise HTTPException(status_code=404, detail="Run not found")

    return {"deleted": True, "run_id": run_id}


@router.post("/{run_id}/user-input", response_model=UserInputResponse)
async def submit_user_input(run_id: str, body: UserInputRequest) -> UserInputResponse:
    """Submit user input for a run that is waiting in WAIT_FOR_USER state."""
    from app.services.orchestrator import submit_user_input as do_submit

    run_id = _canonical_uuid(run_id)
    store = _get_store_or_503()

    if not await _db_or_503("check run existence", store.run_exists(run_id)):
        raise HTTPException(status_code=404, detail="Run not found")

    user_data = body.model_dump(exclude_none=True)
    accepted = do_submit(run_id, user_data)

    if accepted:
        return UserInputResponse(accepted=True, message="Input accepted, research proceeding")
    return UserInputResponse(
        accepted=False,
        message="Run is not waiting for user input (may have already proceeded)",
    )


@router.get("/{run_id}/events", response_model=list[RunEventResponse])
async def get_run_events(
    run_id: str,
    state: str | None = Query(default=None, description="Filter events by state"),
) -> list[RunEventResponse]:
    """Return the event log for a run, optionally filtered by state."""
    run_id = _canonical_uuid(run_id)
    store = _get_store_or_503()

    if not await _db_or_503("check run existence", store.run_exists(run_id)):
        raise HTTPException(status_code=404, detail="Run not found")

    rows = await _db_or_503("fetch run events", store.get_events(run_id=run_id, state=state))
    return [
        RunEventResponse(
            id=_parse_uuid_or_new(row.get("id")),
            run_id=_parse_uuid_or_new(row.get("run_id")),
            timestamp=_parse_datetime(row.get("timestamp")),
            state=str(row.get("state", "")),
            message=str(row.get("message", "")),
            payload=row.get("payload_json") if isinstance(row.get("payload_json"), dict) else None,
        )
        for row in rows
    ]


@router.get("/{run_id}/stream")
async def stream_run_events(run_id: str) -> EventSourceResponse:
    """SSE endpoint that streams run events in real time."""
    run_id = _canonical_uuid(run_id)
    store = _get_store_or_503()

    row = await _db_or_503("read run state", store.get_run(run_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")

    if str(row.get("status", "")) in ("completed", "failed"):
        terminal_state = "finalize" if row.get("status") == "completed" else "failed"

        async def _finished_generator() -> AsyncGenerator[dict[str, str], None]:
            yield {
                "event": "message",
                "data": json.dumps(
                    {
                        "run_id": run_id,
                        "state": terminal_state,
                        "message": f"Run already {row.get('status')}",
                        "payload": {"message": f"Run already {row.get('status')}"},
                    }
                ),
            }

        return EventSourceResponse(_finished_generator())

    queue = register_queue(run_id)

    async def _event_generator() -> AsyncGenerator[dict[str, str], None]:
        try:
            while True:
                try:
                    event_data = await asyncio.wait_for(queue.get(), timeout=60.0)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": ""}
                    continue

                if event_data is None:
                    break

                yield {
                    "event": "message",
                    "data": json.dumps(event_data, default=str),
                }

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
) -> list[RunStatus]:
    """List recent runs with pagination."""
    store = _get_store_or_503()
    rows = await _db_or_503("list runs", store.list_runs(limit=limit, offset=offset))
    return [_run_status_from_doc(row) for row in rows]


@router.get("/{run_id}/pdf")
async def get_run_pdf(run_id: str):
    """Download the PDF report for a completed run."""
    from fastapi.responses import FileResponse
    from app.services.pdf_generator import get_pdf_path, generate_pdf_from_markdown

    run_id = _canonical_uuid(run_id)
    store = _get_store_or_503()

    row = await _db_or_503("read run for PDF", store.get_run(run_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")

    if str(row.get("status", "")) != "completed":
        raise HTTPException(status_code=400, detail="Run not yet completed")

    # Check for existing PDF
    pdf_path = get_pdf_path(run_id)
    if pdf_path is None:
        # Generate on demand
        report_md = row.get("report_md", "")
        if not report_md:
            raise HTTPException(status_code=404, detail="No report available for this run")
        pdf_path = generate_pdf_from_markdown(report_md, run_id)
        if pdf_path is None:
            raise HTTPException(status_code=500, detail="PDF generation failed")

    media_type = "application/pdf" if str(pdf_path).endswith(".pdf") else "text/html"
    return FileResponse(
        path=str(pdf_path),
        media_type=media_type,
        filename=f"research_report_{run_id[:8]}.pdf",
    )


@router.get("/metrics/gate")
async def get_gate_metrics_endpoint():
    """Return research gate routing metrics."""
    from app.services.research_gate import get_gate_metrics
    return get_gate_metrics()
