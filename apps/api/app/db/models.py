"""SQLAlchemy 2.0 ORM models for the research-agent database."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY
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
    claims: Mapped[list["Claim"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="noload"
    )
    kg_edges: Mapped[list["KGEdge"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="noload"
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
    source_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="web"
    )  # web | academic | user_upload
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


# ---------------------------------------------------------------------------
# Knowledge Graph – Nodes
# ---------------------------------------------------------------------------
class KGNode(Base):
    __tablename__ = "kg_nodes"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # Person | Org | Location | Concept | Document | Claim
    canonical_name: Mapped[str] = mapped_column(String(512), nullable=False)
    aliases: Mapped[Optional[list[str]]] = mapped_column(
        ARRAY(String), nullable=True
    )
    metadata_json: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    # Relationships
    edges_from: Mapped[list["KGEdge"]] = relationship(
        "KGEdge",
        foreign_keys="KGEdge.from_node_id",
        back_populates="from_node",
        cascade="all, delete-orphan",
        lazy="noload",
    )
    edges_to: Mapped[list["KGEdge"]] = relationship(
        "KGEdge",
        foreign_keys="KGEdge.to_node_id",
        back_populates="to_node",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    __table_args__ = (
        UniqueConstraint("type", "canonical_name", name="uq_kg_node_type_name"),
        Index("ix_kg_nodes_canonical_name", "canonical_name"),
    )

    def __repr__(self) -> str:
        return f"<KGNode id={self.id!s} type={self.type!r} name={self.canonical_name!r}>"


# ---------------------------------------------------------------------------
# Knowledge Graph – Edges
# ---------------------------------------------------------------------------
class KGEdge(Base):
    __tablename__ = "kg_edges"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    from_node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("kg_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    to_node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("kg_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    relation_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # MENTIONS | SUPPORTS | CONTRADICTS | RELATED_TO | CITES | ABOUT
    confidence: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.5
    )
    evidence_chunk_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("chunks.id", ondelete="SET NULL"), nullable=True
    )
    run_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    # Relationships
    from_node: Mapped["KGNode"] = relationship(
        "KGNode", foreign_keys=[from_node_id], back_populates="edges_from"
    )
    to_node: Mapped["KGNode"] = relationship(
        "KGNode", foreign_keys=[to_node_id], back_populates="edges_to"
    )
    run: Mapped[Optional["Run"]] = relationship(back_populates="kg_edges")

    def __repr__(self) -> str:
        return f"<KGEdge id={self.id!s} {self.relation_type!r}>"


# ---------------------------------------------------------------------------
# Claims – structured claims extracted from reports
# ---------------------------------------------------------------------------
class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    section: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    citation_chunk_ids: Mapped[Optional[list[str]]] = mapped_column(
        ARRAY(String), nullable=True
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)

    # Verification results
    verification_status: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # VERIFIED | WEAK | UNSUPPORTED
    verification_snippet: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence_needed: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    # Relationships
    run: Mapped["Run"] = relationship(back_populates="claims")

    def __repr__(self) -> str:
        return f"<Claim id={self.id!s} status={self.verification_status!r}>"


# ---------------------------------------------------------------------------
# Verification Results – aggregated per run
# ---------------------------------------------------------------------------
class VerificationResult(Base):
    __tablename__ = "verification_results"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=_new_uuid
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    iteration: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Metrics
    citation_coverage: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    groundedness_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    coverage_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    contradiction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_diversity_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Critic evaluation
    structure_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    completeness_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    overall_passed: Mapped[bool] = mapped_column(default=False, nullable=False)

    feedback_json: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    def __repr__(self) -> str:
        return f"<VerificationResult id={self.id!s} run={self.run_id!s} passed={self.overall_passed}>"
