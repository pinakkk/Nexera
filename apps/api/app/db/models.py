"""SQLAlchemy 2.0 ORM models for the research-agent database."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


def _utcnow() -> datetime:
    """Return the current UTC timestamp (timezone-aware)."""
    return datetime.now(timezone.utc)


def _new_uuid() -> uuid.UUID:
    return uuid.uuid4()


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
class Run(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    query: Mapped[str] = mapped_column(Text, nullable=False)
    constraints_json: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )
    report_md: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    report_json: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    scores_json: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    model_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    iteration_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationships
    events: Mapped[list["RunEvent"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin"
    )
    citations: Mapped[list["Citation"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin"
    )
    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin"
    )
    sources: Mapped[list["Source"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Run id={self.id!s} status={self.status!r}>"


# ---------------------------------------------------------------------------
# RunEvent
# ---------------------------------------------------------------------------
class RunEvent(Base):
    __tablename__ = "run_events"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    state: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    payload_json: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )

    # Relationships
    run: Mapped["Run"] = relationship(back_populates="events")

    def __repr__(self) -> str:
        return f"<RunEvent id={self.id!s} state={self.state!r}>"


# ---------------------------------------------------------------------------
# Document
# ---------------------------------------------------------------------------
class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    url: Mapped[str] = mapped_column(String(2048), unique=True, nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    domain: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    raw_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    clean_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    metadata_json: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    content_hash: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )

    # Relationships
    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", lazy="selectin"
    )
    citations: Mapped[list["Citation"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Document id={self.id!s} url={self.url!r}>"


# ---------------------------------------------------------------------------
# Chunk
# ---------------------------------------------------------------------------
class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metadata_json: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )

    # Relationships
    document: Mapped["Document"] = relationship(back_populates="chunks")
    run: Mapped[Optional["Run"]] = relationship(back_populates="chunks")
    citations: Mapped[list["Citation"]] = relationship(
        back_populates="chunk", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Chunk id={self.id!s} doc={self.document_id!s} idx={self.chunk_index}>"


# ---------------------------------------------------------------------------
# Citation
# ---------------------------------------------------------------------------
class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("chunks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    claim_text: Mapped[str] = mapped_column(Text, nullable=False)
    snippet: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    section_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Relationships
    run: Mapped["Run"] = relationship(back_populates="citations")
    document: Mapped["Document"] = relationship(back_populates="citations")
    chunk: Mapped[Optional["Chunk"]] = relationship(back_populates="citations")

    def __repr__(self) -> str:
        return f"<Citation id={self.id!s} run={self.run_id!s}>"


# ---------------------------------------------------------------------------
# Source  (user-uploaded files or URLs queued for ingestion)
# ---------------------------------------------------------------------------
class Source(Base):
    __tablename__ = "sources"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    filename: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    content_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    raw_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    # Relationships
    run: Mapped[Optional["Run"]] = relationship(back_populates="sources")

    def __repr__(self) -> str:
        return f"<Source id={self.id!s} status={self.status!r}>"
