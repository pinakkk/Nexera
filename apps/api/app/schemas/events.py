"""Pydantic schemas for server-sent events (SSE) and run events."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class RunEventResponse(BaseModel):
    """Single run event as returned by the REST events endpoint."""

    id: UUID
    run_id: UUID
    timestamp: datetime
    state: str
    message: str
    payload: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


class SSEEvent(BaseModel):
    """Shape of a server-sent event pushed over the SSE stream."""

    event: str = Field(..., description="SSE event name, e.g. 'state_change'.")
    data: dict[str, Any] = Field(
        ...,
        description="Event data containing run_id, timestamp, state, message, payload.",
    )

    @classmethod
    def from_run_event(
        cls,
        *,
        run_id: UUID,
        state: str,
        message: str,
        payload: dict[str, Any] | None = None,
        event_name: str = "state_change",
    ) -> "SSEEvent":
        """Convenience factory to build an SSEEvent from individual parts."""
        return cls(
            event=event_name,
            data={
                "run_id": str(run_id),
                "timestamp": datetime.utcnow().isoformat(),
                "state": state,
                "message": message,
                "payload": payload,
            },
        )
