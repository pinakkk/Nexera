"""Postgres/Supabase storage layer (drop-in replacement for MongoStore).

This module mirrors :class:`app.db.mongo.MongoStore` method-for-method so the
API layer (``runs.py``, ``sources.py``, ``orchestrator.py``) keeps working
unchanged.  Every public method returns plain ``dict``s with Mongo-style keys
(``id`` as ``str``, ``citations`` as a list on the run dict, JSON columns as
plain dicts) rather than ORM objects, because callers read those keys directly.

Schema is owned by Alembic; :meth:`SupabaseStore.ensure_indexes` is a no-op
kept only so callers that call it (e.g. startup) do not break.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.database import ensure_database_ready, engine, get_db
from app.db.models import Citation, Run, RunEvent, Source

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_timestamp(value: str | datetime | None) -> datetime:
    """Coerce an event timestamp into a tz-aware ``datetime``."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return _utcnow()


def _as_uuid(value: Any) -> uuid.UUID:
    """Accept either a ``str`` or :class:`uuid.UUID` and return a UUID.

    The app passes string UUIDs everywhere, but be defensive and accept UUID
    objects too.
    """
    if isinstance(value, uuid.UUID):
        return value
    return uuid.UUID(str(value))


def _as_uuid_or_none(value: Any) -> uuid.UUID | None:
    if value is None:
        return None
    try:
        return _as_uuid(value)
    except (TypeError, ValueError):
        return None


class StoreUnavailableError(RuntimeError):
    """Raised when the Postgres store cannot be reached or initialized.

    Analog of :class:`app.db.mongo.MongoUnavailableError`.
    """


def describe_db_error(exc: Exception) -> str:
    """Return a friendly explanation for a Postgres/asyncpg failure.

    Ports the spirit of ``app.db.mongo.describe_mongo_error`` for the
    Postgres/asyncpg/SQLAlchemy stack.
    """
    if isinstance(exc, StoreUnavailableError):
        return str(exc)

    message = str(exc).strip()
    lower = message.lower()

    if "password authentication failed" in lower or "authentication failed" in lower:
        return (
            "Postgres authentication failed. Verify the user/password in "
            "DATABASE_URL (Supabase: Project Settings → Database)."
        )

    if "role" in lower and "does not exist" in lower:
        return (
            "Postgres role does not exist. Check the username portion of "
            "DATABASE_URL."
        )

    if "database" in lower and "does not exist" in lower:
        return (
            "Target Postgres database does not exist. Check the database name "
            "in DATABASE_URL."
        )

    if "connection refused" in lower or "could not connect" in lower:
        return (
            "Postgres connection refused. Confirm the host/port in "
            "DATABASE_URL and that the database is running and reachable."
        )

    if (
        "name or service not known" in lower
        or "nodename nor servname" in lower
        or "could not translate host name" in lower
        or "temporary failure in name resolution" in lower
    ):
        return (
            "Postgres host DNS lookup failed. Verify the host in DATABASE_URL; "
            "if DNS is broken, set resolvers to 1.1.1.1 / 8.8.8.8."
        )

    if "timeout" in lower or "timed out" in lower:
        return (
            "Postgres connection timed out. Check network reachability, "
            "firewall/VPN, and that the database accepts your client IP "
            "(Supabase network restrictions)."
        )

    if (
        ("type" in lower and "vector" in lower and "does not exist" in lower)
        or "extension \"vector\"" in lower
        or "pgvector" in lower
    ):
        return (
            "The pgvector extension is missing. Run "
            "'CREATE EXTENSION IF NOT EXISTS vector;' (Supabase: Database → "
            "Extensions) before migrating, since models declare Vector(384) "
            "columns."
        )

    if "ssl" in lower and ("required" in lower or "off" in lower):
        return (
            "Postgres requires SSL. Append '?sslmode=require' (or the asyncpg "
            "equivalent) to DATABASE_URL."
        )

    if message:
        return f"Postgres connection failed: {message}"
    return "Postgres connection failed."


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------
class SupabaseStore:
    """Async SQLAlchemy-on-Postgres store mirroring :class:`MongoStore`.

    All methods are ``async`` and use the shared async session from
    :mod:`app.db.database`.  Return shapes are plain dicts with Mongo doc keys
    so the API layer stays untouched.
    """

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def ping(self) -> None:
        """Execute ``SELECT 1`` to verify connectivity."""
        async with get_db() as session:
            await session.execute(text("SELECT 1"))

    async def ensure_indexes(self) -> None:
        """No-op: Alembic owns the schema/indexes.

        Kept so callers that invoke it during startup do not break.
        """
        return None

    # ------------------------------------------------------------------
    # Scoping (security-critical)
    # ------------------------------------------------------------------
    @staticmethod
    def _scope_conditions(
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[Any]:
        """Return SQLAlchemy WHERE conditions replicating ``_scope_filter``.

        - ``user_id``  → filter by ``Run.user_id``
        - ``session_id`` → filter by ``Run.session_id``
        - neither     → match NOTHING (sentinel ``1=0``); never return
          unscoped rows, since that would leak other actors' runs.
        """
        if user_id:
            return [Run.user_id == user_id]
        if session_id:
            return [Run.session_id == session_id]
        return [text("1=0")]

    # ------------------------------------------------------------------
    # Row adapters
    # ------------------------------------------------------------------
    @staticmethod
    def _run_to_dict(run: Run) -> dict[str, Any]:
        """Convert a :class:`Run` ORM object into a Mongo-style dict.

        ``citations`` is exposed as a list on the run dict: prefer the mirror
        in ``report_json["citations"]`` (written by :meth:`update_run_final`),
        falling back to the related :class:`Citation` rows.
        """
        report_json = run.report_json if isinstance(run.report_json, dict) else (
            {} if run.report_json is None else run.report_json
        )

        citations: list[dict[str, Any]]
        if isinstance(report_json, dict) and isinstance(
            report_json.get("citations"), list
        ):
            citations = report_json["citations"]
        else:
            citations = [SupabaseStore._citation_to_dict(c) for c in (run.citations or [])]

        return {
            "id": str(run.id),
            "user_id": run.user_id,
            "session_id": run.session_id,
            "thread_id": run.thread_id,
            "gate_route": run.gate_route,
            "query": run.query,
            "constraints_json": (
                run.constraints_json
                if isinstance(run.constraints_json, dict)
                else (run.constraints_json or None)
            ),
            "status": run.status,
            "report_md": run.report_md,
            "report_json": (
                run.report_json
                if isinstance(run.report_json, dict)
                else (run.report_json or None)
            ),
            "scores_json": (
                run.scores_json
                if isinstance(run.scores_json, dict)
                else (run.scores_json or None)
            ),
            "citations": citations,
            "model_name": run.model_name,
            "iteration_count": run.iteration_count,
            "created_at": run.created_at,
            "finished_at": run.finished_at,
        }

    @staticmethod
    def _citation_to_dict(citation: Citation) -> dict[str, Any]:
        return {
            "id": str(citation.id),
            "run_id": str(citation.run_id),
            "document_id": str(citation.document_id) if citation.document_id else None,
            "chunk_id": str(citation.chunk_id) if citation.chunk_id else None,
            "claim_text": citation.claim_text,
            "snippet": citation.snippet,
            "url": citation.url,
            "section_key": citation.section_key,
        }

    @staticmethod
    def _event_to_dict(event: RunEvent) -> dict[str, Any]:
        return {
            "id": str(event.id),
            "run_id": str(event.run_id),
            "timestamp": event.timestamp,
            "state": event.state,
            "message": event.message,
            "payload_json": (
                event.payload_json if isinstance(event.payload_json, dict) else {}
            ),
        }

    @staticmethod
    def _source_to_dict(source: Source) -> dict[str, Any]:
        return {
            "id": str(source.id),
            "run_id": str(source.run_id) if source.run_id else None,
            "filename": source.filename,
            "url": source.url,
            "content_type": source.content_type,
            "raw_text": source.raw_text,
            "status": source.status,
            "created_at": source.created_at,
        }

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------
    async def create_run(self, doc: dict[str, Any]) -> None:
        """Insert a new run from a Mongo-style ``doc``.

        Only columns the ``Run`` model knows about are mapped; the Mongo
        ``citations`` list (always ``[]`` at creation in runs.py) is ignored
        here — citations become rows in :meth:`update_run_final`.
        """
        async with get_db() as session:
            run = Run(
                id=_as_uuid(doc["id"]),
                user_id=doc.get("user_id"),
                session_id=doc.get("session_id"),
                thread_id=doc.get("thread_id"),
                gate_route=doc.get("gate_route"),
                query=doc.get("query", ""),
                constraints_json=doc.get("constraints_json"),
                status=doc.get("status", "pending"),
                report_md=doc.get("report_md"),
                report_json=doc.get("report_json"),
                scores_json=doc.get("scores_json"),
                model_name=doc.get("model_name"),
                iteration_count=int(doc.get("iteration_count", 0) or 0),
                created_at=doc.get("created_at") or _utcnow(),
                finished_at=doc.get("finished_at"),
            )
            session.add(run)

    async def get_run(
        self,
        run_id: str,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Return a single scoped run as a Mongo-style dict, or ``None``."""
        rid = _as_uuid_or_none(run_id)
        if rid is None:
            return None
        async with get_db() as session:
            stmt = select(Run).where(
                Run.id == rid, *self._scope_conditions(user_id, session_id)
            )
            run = (await session.execute(stmt)).scalar_one_or_none()
            if run is None:
                return None
            return self._run_to_dict(run)

    async def run_exists(
        self,
        run_id: str,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> bool:
        """Return ``True`` if a scoped run with ``run_id`` exists."""
        rid = _as_uuid_or_none(run_id)
        if rid is None:
            return False
        async with get_db() as session:
            stmt = select(Run.id).where(
                Run.id == rid, *self._scope_conditions(user_id, session_id)
            )
            return (await session.execute(stmt)).first() is not None

    async def list_runs(
        self,
        limit: int,
        offset: int,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List runs collapsed to one row per thread, newest first.

        Mirrors the Mongo aggregation that groups by
        ``{$ifNull: [thread_id, id]}`` and keeps the most recent run per
        group.  Implemented with ``DISTINCT ON (coalesce(thread_id, id::text))``
        ordered so the latest run per thread wins, then re-sorted by
        ``created_at`` desc with offset/limit.
        """
        async with get_db() as session:
            thread_key = func_coalesce_thread()
            # Inner query: latest run per thread (DISTINCT ON keeps the first
            # row per key given the ORDER BY).
            inner = (
                select(Run)
                .where(*self._scope_conditions(user_id, session_id))
                .distinct(thread_key)
                .order_by(thread_key, Run.created_at.desc())
                .subquery()
            )
            aliased_run = _aliased_run(inner)
            stmt = (
                select(aliased_run)
                .order_by(inner.c.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
            runs = (await session.execute(stmt)).scalars().all()
            return [self._run_to_dict(r) for r in runs]

    async def get_thread_runs(
        self,
        thread_id: str,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return all scoped runs belonging to ``thread_id``.

        Ordering is left to the caller (runs.py sorts ascending), matching
        Mongo's unsorted ``find``.
        """
        async with get_db() as session:
            stmt = select(Run).where(
                Run.thread_id == thread_id,
                *self._scope_conditions(user_id, session_id),
            )
            runs = (await session.execute(stmt)).scalars().all()
            return [self._run_to_dict(r) for r in runs]

    async def update_run_final(
        self,
        *,
        run_id: str,
        status: str,
        report_md: str,
        report_json: dict[str, Any],
        scores_json: dict[str, Any],
        citations: list[dict[str, Any]],
        model_name: str | None,
        iteration_count: int,
    ) -> None:
        """Finalize a run: write report fields, mirror + materialize citations.

        ``citations`` are persisted both as :class:`Citation` rows and mirrored
        into ``report_json["citations"]`` so :meth:`get_run` returns them on
        the run dict (callers read ``run["citations"]`` directly).
        """
        rid = _as_uuid(run_id)
        # Mirror citations into report_json so get_run() always returns them
        # even if Citation FK columns (document_id) can't be satisfied.
        report_json = dict(report_json or {})
        report_json["citations"] = citations or []

        async with get_db() as session:
            run = (
                await session.execute(select(Run).where(Run.id == rid))
            ).scalar_one_or_none()
            if run is None:
                logger.warning("update_run_final: run %s not found", run_id)
                return

            run.status = status
            run.report_md = report_md
            run.report_json = report_json
            run.scores_json = scores_json
            run.model_name = model_name
            run.iteration_count = int(iteration_count or 0)
            run.finished_at = _utcnow()

            # Replace Citation rows for this run with the supplied list.
            await session.execute(delete(Citation).where(Citation.run_id == rid))
            for item in citations or []:
                if not isinstance(item, dict):
                    continue
                doc_id = _as_uuid_or_none(item.get("document_id"))
                # Citation.document_id is NOT NULL; skip rows without a valid
                # document FK (the report_json mirror still carries them).
                if doc_id is None:
                    continue
                session.add(
                    Citation(
                        id=_as_uuid_or_none(item.get("id")) or uuid.uuid4(),
                        run_id=rid,
                        document_id=doc_id,
                        chunk_id=_as_uuid_or_none(item.get("chunk_id")),
                        claim_text=str(item.get("claim_text", "")),
                        snippet=str(item.get("snippet", "")),
                        url=str(item.get("url", "")),
                        section_key=(
                            str(item["section_key"])
                            if item.get("section_key") is not None
                            else None
                        ),
                    )
                )

    async def mark_run_failed(self, run_id: str) -> None:
        """Mark a run failed and stamp ``finished_at``."""
        rid = _as_uuid_or_none(run_id)
        if rid is None:
            return
        async with get_db() as session:
            run = (
                await session.execute(select(Run).where(Run.id == rid))
            ).scalar_one_or_none()
            if run is None:
                return
            run.status = "failed"
            run.finished_at = _utcnow()

    async def delete_run(
        self,
        run_id: str,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> bool:
        """Delete a scoped run; return ``False`` if nothing was deleted.

        ``run_events`` (and ``citations``) cascade via ``ON DELETE CASCADE``.
        ``sources.run_id`` is ``ON DELETE SET NULL``, so explicitly delete
        sources for the run to match Mongo's ``delete_many``.
        """
        rid = _as_uuid_or_none(run_id)
        if rid is None:
            return False
        async with get_db() as session:
            run = (
                await session.execute(
                    select(Run).where(
                        Run.id == rid,
                        *self._scope_conditions(user_id, session_id),
                    )
                )
            ).scalar_one_or_none()
            if run is None:
                return False

            await session.execute(delete(Source).where(Source.run_id == rid))
            await session.delete(run)
            return True

    # ------------------------------------------------------------------
    # Run events
    # ------------------------------------------------------------------
    async def append_event(
        self,
        *,
        event_id: str,
        run_id: str,
        state: str,
        message: str,
        payload: dict[str, Any] | None,
        timestamp: str | datetime | None = None,
    ) -> None:
        """Append a run-event row."""
        async with get_db() as session:
            session.add(
                RunEvent(
                    id=_as_uuid_or_none(event_id) or uuid.uuid4(),
                    run_id=_as_uuid(run_id),
                    timestamp=_parse_timestamp(timestamp),
                    state=state,
                    message=message or "",
                    payload_json=payload or {},
                )
            )

    async def get_events(
        self, run_id: str, state: str | None = None
    ) -> list[dict[str, Any]]:
        """Return events for a run ordered by ``timestamp`` ascending."""
        rid = _as_uuid_or_none(run_id)
        if rid is None:
            return []
        async with get_db() as session:
            stmt = select(RunEvent).where(RunEvent.run_id == rid)
            if state:
                stmt = stmt.where(RunEvent.state == state)
            stmt = stmt.order_by(RunEvent.timestamp.asc())
            events = (await session.execute(stmt)).scalars().all()
            return [self._event_to_dict(e) for e in events]

    # ------------------------------------------------------------------
    # Sources
    # ------------------------------------------------------------------
    async def create_source(self, doc: dict[str, Any]) -> dict[str, Any]:
        """Insert one source and return it as a Mongo-style dict."""
        async with get_db() as session:
            source = self._build_source(doc)
            session.add(source)
            await session.flush()
            return self._source_to_dict(source)

    async def create_sources(
        self, docs: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Bulk-insert sources and return them as Mongo-style dicts."""
        if not docs:
            return []
        async with get_db() as session:
            sources = [self._build_source(d) for d in docs]
            session.add_all(sources)
            await session.flush()
            return [self._source_to_dict(s) for s in sources]

    async def get_source(self, source_id: str) -> dict[str, Any] | None:
        """Return a single source as a Mongo-style dict, or ``None``."""
        sid = _as_uuid_or_none(source_id)
        if sid is None:
            return None
        async with get_db() as session:
            source = (
                await session.execute(select(Source).where(Source.id == sid))
            ).scalar_one_or_none()
            if source is None:
                return None
            return self._source_to_dict(source)

    @staticmethod
    def _build_source(doc: dict[str, Any]) -> Source:
        return Source(
            id=_as_uuid_or_none(doc.get("id")) or uuid.uuid4(),
            run_id=_as_uuid_or_none(doc.get("run_id")),
            filename=doc.get("filename"),
            url=doc.get("url"),
            content_type=doc.get("content_type"),
            raw_text=doc.get("raw_text"),
            status=doc.get("status", "pending"),
            created_at=doc.get("created_at") or _utcnow(),
        )


# ---------------------------------------------------------------------------
# Query helpers for thread-collapsing list_runs
# ---------------------------------------------------------------------------
def func_coalesce_thread():
    """``coalesce(runs.thread_id, runs.id::text)`` expression for DISTINCT ON."""
    from sqlalchemy import cast, func
    from sqlalchemy import String as SAString

    return func.coalesce(Run.thread_id, cast(Run.id, SAString))


def _aliased_run(subquery):
    """Map a Run-shaped subquery back onto the ORM entity."""
    from sqlalchemy.orm import aliased

    return aliased(Run, subquery)


# ---------------------------------------------------------------------------
# Module-level accessors (analogous to get_mongo_store / ensure_mongo_ready)
# ---------------------------------------------------------------------------
@lru_cache
def get_store() -> SupabaseStore:
    """Return a process-wide :class:`SupabaseStore` singleton.

    Raises :class:`StoreUnavailableError` if the engine is unavailable (e.g.
    ``ALLOW_START_WITHOUT_DB=true``).
    """
    if engine is None:
        raise StoreUnavailableError(
            "SQL engine is not initialized (ALLOW_START_WITHOUT_DB=true or "
            "DATABASE_URL unset). Cannot use the Postgres store."
        )
    return SupabaseStore()


async def ensure_database_ready_store() -> None:
    """Verify DB connectivity for the store (analog of ``ensure_mongo_ready``).

    Reuses :func:`app.db.database.ensure_database_ready` (retrying
    ``SELECT 1``) and then pings + ensures indexes through the store so the
    failure surface matches the old Mongo path.
    """
    try:
        await ensure_database_ready()
        store = get_store()
        await store.ping()
        await store.ensure_indexes()
    except StoreUnavailableError:
        raise
    except Exception as exc:
        raise StoreUnavailableError(describe_db_error(exc)) from exc
