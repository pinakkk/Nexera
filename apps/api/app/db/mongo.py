"""MongoDB storage helpers for run/event/source persistence."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any
from urllib.parse import parse_qs, urlparse

from app.config import get_settings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_timestamp(value: str | datetime | None) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return _utcnow()


class MongoUnavailableError(RuntimeError):
    """Raised when MongoDB cannot be reached or initialized."""


def describe_mongo_error(exc: Exception) -> str:
    if isinstance(exc, MongoUnavailableError):
        return str(exc)

    message = str(exc).strip()
    lower = message.lower()

    if "nameservers failed" in lower and "_mongodb._tcp" in lower:
        return (
            "MongoDB Atlas SRV DNS lookup failed. Your DNS resolver cannot resolve "
            "the cluster host. Switch DNS to 8.8.8.8/1.1.1.1 or use a non-SRV "
            "mongodb:// URI with explicit hosts."
        )

    if "empty database name not allowed" in lower:
        return (
            "MongoDB database name is missing in DATABASE_URL. Use a URL like "
            "mongodb+srv://.../<db-name>?..."
        )

    if "not authorized" in lower or "unauthorized" in lower:
        return (
            "MongoDB user is not authorized for this operation. Grant readWrite "
            "access on the target database in Atlas."
        )

    if "authentication failed" in lower or "bad auth" in lower:
        return "MongoDB authentication failed. Verify credentials in DATABASE_URL."

    if "certificate verify failed" in lower or "tlsv1 alert unknown ca" in lower:
        return (
            "MongoDB TLS certificate verification failed. Ensure your Python trust "
            "store is installed, or use certifi-backed CA bundle configuration."
        )

    if ("access list" in lower or "whitelist" in lower) and "ip" in lower:
        return (
            "MongoDB Atlas network access blocked this client IP. Add your current "
            "IP address to Atlas Network Access."
        )

    if "timed out" in lower or "server selection" in lower:
        return (
            "MongoDB connection timed out. Check Atlas cluster status, network "
            "reachability, and firewall/proxy settings."
        )

    if message:
        return f"MongoDB connection failed: {message}"
    return "MongoDB connection failed."


def _extract_db_name(uri: str) -> str:
    parsed = urlparse(uri)
    name = parsed.path.lstrip("/").strip()
    return name or "nexera"


def _is_truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _is_falsy(value: str) -> bool:
    return value.strip().lower() in {"0", "false", "no", "off"}


def _resolve_tls_ca_file(uri: str) -> str | None:
    parsed = urlparse(uri)
    if parsed.scheme not in {"mongodb", "mongodb+srv"}:
        return None

    query = {key.lower(): values for key, values in parse_qs(parsed.query).items()}
    if "tlscafile" in query or "ssl_ca_certs" in query:
        return None

    tls_enabled = parsed.scheme == "mongodb+srv"
    for key in ("tls", "ssl"):
        values = query.get(key)
        if not values:
            continue
        value = values[-1]
        if _is_truthy(value):
            tls_enabled = True
        elif _is_falsy(value):
            tls_enabled = False

    if not tls_enabled:
        return None

    try:
        import certifi
    except Exception:
        return None
    return certifi.where()


def _require_pymongo() -> tuple[Any, Any, Any]:
    try:
        from pymongo import ASCENDING, DESCENDING, MongoClient
    except ImportError as exc:  # pragma: no cover - dependency/install issue
        raise RuntimeError(
            "pymongo is required for MongoDB mode. Install with: pip install pymongo"
        ) from exc
    return MongoClient, ASCENDING, DESCENDING



def _drop_stale_indexes(collection: Any, prefixes: set[str]) -> None:
    """Drop indexes whose name starts with any of the given prefixes.

    Used to clean up leftover unique indexes from previous ORM schemas
    (e.g. Prisma) that cause E11000 errors on null fields.
    """
    import logging as _log

    try:
        for idx_info in collection.list_indexes():
            name = idx_info.get("name", "")
            if name == "_id_":
                continue
            if any(name.startswith(p) or p in name for p in prefixes):
                _log.getLogger(__name__).info(
                    "Dropping stale index '%s' from collection '%s'",
                    name,
                    collection.name,
                )
                collection.drop_index(name)
    except Exception as exc:
        _log.getLogger(__name__).warning(
            "Failed to drop stale indexes from %s: %s", collection.name, exc
        )


class MongoStore:
    """Small async wrapper over PyMongo for API persistence needs."""

    def __init__(self, uri: str) -> None:
        mongo_client, _, _ = _require_pymongo()
        client_kwargs: dict[str, Any] = {
            "tz_aware": True,
            "serverSelectionTimeoutMS": 5000,
        }
        tls_ca_file = _resolve_tls_ca_file(uri)
        if tls_ca_file:
            client_kwargs["tlsCAFile"] = tls_ca_file

        self._client = mongo_client(uri, **client_kwargs)
        self._db = self._client[_extract_db_name(uri)]
        self._runs = self._db["runs"]
        self._run_events = self._db["run_events"]
        self._sources = self._db["sources"]

    async def ping(self) -> None:
        await asyncio.to_thread(self._client.admin.command, "ping")

    async def ensure_indexes(self) -> None:
        _, asc, desc = _require_pymongo()

        def _create() -> None:
            # ── Drop stale indexes from previous schemas (e.g. Prisma) ────
            # These unique indexes on fields the current code never sets
            # cause E11000 duplicate-key errors on null values.
            _drop_stale_indexes(self._runs, {"public_id_", "runs_public_id"})
            _drop_stale_indexes(self._run_events, {"public_id_", "run_events_public_id"})
            _drop_stale_indexes(self._sources, {"public_id_", "sources_public_id"})

            self._runs.create_index([("id", asc)], unique=True)
            self._runs.create_index([("created_at", desc)])
            self._runs.create_index([("user_id", asc), ("created_at", desc)])
            self._run_events.create_index([("id", asc)], unique=True)
            self._run_events.create_index([("run_id", asc), ("timestamp", asc)])
            self._sources.create_index([("id", asc)], unique=True)
            self._sources.create_index([("created_at", desc)])

        await asyncio.to_thread(_create)

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

    async def create_run(self, doc: dict[str, Any]) -> None:
        payload = {**doc}
        await asyncio.to_thread(self._runs.insert_one, payload)

    async def get_run(self, run_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._runs.find_one,
            {"id": run_id},
            {"_id": 0},
        )

    async def run_exists(self, run_id: str) -> bool:
        row = await asyncio.to_thread(self._runs.find_one, {"id": run_id}, {"_id": 1})
        return row is not None

    async def list_runs(self, limit: int, offset: int, user_id: str | None = None) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            query: dict[str, Any] = {}
            if user_id:
                query["user_id"] = user_id
            cursor = (
                self._runs.find(query, {"_id": 0})
                .sort("created_at", -1)
                .skip(offset)
                .limit(limit)
            )
            return list(cursor)

        return await asyncio.to_thread(_list)

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
        await asyncio.to_thread(
            self._runs.update_one,
            {"id": run_id},
            {
                "$set": {
                    "status": status,
                    "report_md": report_md,
                    "report_json": report_json,
                    "scores_json": scores_json,
                    "citations": citations,
                    "model_name": model_name,
                    "iteration_count": iteration_count,
                    "finished_at": _utcnow(),
                }
            },
        )

    async def mark_run_failed(self, run_id: str) -> None:
        await asyncio.to_thread(
            self._runs.update_one,
            {"id": run_id},
            {"$set": {"status": "failed", "finished_at": _utcnow()}},
        )

    async def delete_run(self, run_id: str) -> bool:
        result = await asyncio.to_thread(self._runs.delete_one, {"id": run_id})
        if result.deleted_count == 0:
            return False

        await asyncio.to_thread(self._run_events.delete_many, {"run_id": run_id})
        await asyncio.to_thread(self._sources.delete_many, {"run_id": run_id})
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
        doc = {
            "id": event_id,
            "run_id": run_id,
            "timestamp": _parse_timestamp(timestamp),
            "state": state,
            "message": message,
            "payload_json": payload or {},
        }
        await asyncio.to_thread(self._run_events.insert_one, doc)

    async def get_events(self, run_id: str, state: str | None = None) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"run_id": run_id}
        if state:
            query["state"] = state

        def _list() -> list[dict[str, Any]]:
            return list(
                self._run_events.find(query, {"_id": 0}).sort("timestamp", 1)
            )

        return await asyncio.to_thread(_list)

    # ------------------------------------------------------------------
    # Sources
    # ------------------------------------------------------------------

    async def create_source(self, doc: dict[str, Any]) -> dict[str, Any]:
        payload = {**doc}
        await asyncio.to_thread(self._sources.insert_one, payload)
        return payload

    async def create_sources(self, docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not docs:
            return []

        payload = [{**doc} for doc in docs]
        await asyncio.to_thread(self._sources.insert_many, payload)
        return payload

    async def get_source(self, source_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(
            self._sources.find_one,
            {"id": source_id},
            {"_id": 0},
        )


@lru_cache
def get_mongo_store() -> MongoStore:
    settings = get_settings()
    uri = settings.DATABASE_URL.strip()
    if not uri:
        raise MongoUnavailableError(
            "DATABASE_URL is empty. Set a valid MongoDB connection string."
        )

    try:
        return MongoStore(uri)
    except Exception as exc:
        raise MongoUnavailableError(describe_mongo_error(exc)) from exc


async def ensure_mongo_ready() -> None:
    store = get_mongo_store()
    try:
        await store.ping()
        await store.ensure_indexes()
    except Exception as exc:
        raise MongoUnavailableError(describe_mongo_error(exc)) from exc
