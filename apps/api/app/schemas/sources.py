"""Pydantic schemas for user-supplied sources (URLs / uploads)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class SourceCreate(BaseModel):
    """Payload to register external URLs as sources for a run."""

    urls: Optional[list[str]] = Field(
        default=None,
        description="List of URLs to ingest as source material.",
    )


class SourceResponse(BaseModel):
    """Response model for a persisted source record."""

    id: UUID
    filename: Optional[str] = None
    url: Optional[str] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
