"""Pydantic schemas for research runs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------
class RunConstraints(BaseModel):
    """User-supplied constraints that govern a research run."""

    depth: str = Field(
        default="standard",
        description="Research depth: 'quick', 'standard', or 'deep'.",
        pattern="^(quick|standard|deep)$",
    )
    timeframe: Optional[str] = Field(
        default=None,
        description="Optional time-frame filter, e.g. 'past_week', 'past_month'.",
    )
    allowed_domains: Optional[list[str]] = Field(
        default=None,
        description="If provided, restrict web search to these domains.",
    )
    citation_style: str = Field(
        default="numbered",
        description="Citation style for the final report.",
    )
    initial_model: Optional[str] = Field(
        default=None,
        description="Override the default LLM model for this run.",
    )


class RunCreate(BaseModel):
    """Payload to create a new research run."""

    query: str = Field(..., min_length=1, max_length=2000, description="Research question.")
    constraints: Optional[RunConstraints] = Field(
        default=None,
        description="Optional constraints for the run.",
    )


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------
class RunStatus(BaseModel):
    """Lightweight status view of a run (no report body)."""

    id: UUID
    query: str
    status: str
    created_at: datetime
    finished_at: Optional[datetime] = None
    iteration_count: int = 0
    model_name: Optional[str] = None

    model_config = {"from_attributes": True}


class CitationOut(BaseModel):
    """A single citation entry returned inside RunResult."""

    id: UUID
    claim_text: str
    snippet: str
    url: str
    section_key: Optional[str] = None

    model_config = {"from_attributes": True}


class RunResult(BaseModel):
    """Complete result of a finished (or in-progress) run."""

    id: UUID
    query: str
    status: str
    created_at: datetime
    finished_at: Optional[datetime] = None
    iteration_count: int = 0
    model_name: Optional[str] = None
    report_md: Optional[str] = None
    report_json: Optional[dict[str, Any]] = None
    scores: Optional[dict[str, Any]] = None
    citations: Optional[list[CitationOut]] = None

    model_config = {"from_attributes": True}
