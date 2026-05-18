"""Source ingestion and metadata endpoints."""

from __future__ import annotations

import hashlib
import json as json_stdlib
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.db.store import (
    SupabaseStore,
    StoreUnavailableError,
    describe_db_error,
    get_store,
)
from app.schemas.sources import SourceCreate, SourceResponse

router = APIRouter(prefix="/sources")
logger = logging.getLogger(__name__)

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", "uploads"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _get_store_or_503() -> SupabaseStore:
    try:
        return get_store()
    except StoreUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


async def _db_or_503(action: str, operation: Any) -> Any:
    try:
        return await operation
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Database operation failed while trying to %s", action)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Database operation failed while attempting to {action}: "
                f"{describe_db_error(exc)}"
            ),
        ) from exc


def _canonical_uuid(value: str, detail: str = "Source not found") -> str:
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


def _source_response_from_doc(doc: dict[str, Any]) -> SourceResponse:
    return SourceResponse(
        id=uuid.UUID(str(doc["id"])),
        filename=doc.get("filename"),
        url=doc.get("url"),
        status=str(doc.get("status", "pending")),
        created_at=_parse_datetime(doc.get("created_at")),
    )


async def _save_upload(upload: UploadFile) -> tuple[str, str]:
    """Save an uploaded file to disk and return (path, content_hash)."""
    content = await upload.read()
    content_hash = hashlib.sha256(content).hexdigest()
    ext = Path(upload.filename or "file").suffix
    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / safe_name
    dest.write_bytes(content)
    return str(dest), content_hash


@router.post("/ingest", response_model=list[SourceResponse])
async def ingest_sources(
    files: list[UploadFile] | None = File(default=None),
    urls_json: str | None = Form(default=None),
) -> list[SourceResponse]:
    """Ingest sources from file uploads OR a JSON form field with URLs."""
    created: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    store = _get_store_or_503()

    if files:
        for upload in files:
            _, _ = await _save_upload(upload)
            created.append(
                {
                    "id": str(uuid.uuid4()),
                    "run_id": None,
                    "filename": upload.filename,
                    "url": None,
                    "content_type": upload.content_type,
                    "raw_text": None,
                    "status": "pending",
                    "created_at": now,
                }
            )

    if urls_json:
        try:
            url_list: list[str] = json_stdlib.loads(urls_json)
            if not isinstance(url_list, list):
                raise TypeError("urls_json must be a JSON array")
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=422, detail=f"Invalid urls_json: {exc}")

        for url in url_list:
            created.append(
                {
                    "id": str(uuid.uuid4()),
                    "run_id": None,
                    "filename": None,
                    "url": url,
                    "content_type": None,
                    "raw_text": None,
                    "status": "pending",
                    "created_at": now,
                }
            )

    if not created:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one file upload or URL in urls_json.",
        )

    rows = await _db_or_503("ingest sources", store.create_sources(created))
    return [_source_response_from_doc(row) for row in rows]


@router.post("/ingest/urls", response_model=list[SourceResponse])
async def ingest_urls(body: SourceCreate) -> list[SourceResponse]:
    """Ingest sources from a JSON body containing URLs."""
    if not body.urls:
        raise HTTPException(status_code=422, detail="urls list must not be empty")

    now = datetime.now(timezone.utc)
    store = _get_store_or_503()
    created = [
        {
            "id": str(uuid.uuid4()),
            "run_id": None,
            "filename": None,
            "url": url,
            "content_type": None,
            "raw_text": None,
            "status": "pending",
            "created_at": now,
        }
        for url in body.urls
    ]
    rows = await _db_or_503("ingest URL sources", store.create_sources(created))
    return [_source_response_from_doc(row) for row in rows]


@router.get("/{source_id}", response_model=SourceResponse)
async def get_source(source_id: str) -> SourceResponse:
    """Return metadata for a single source."""
    source_id = _canonical_uuid(source_id)
    store = _get_store_or_503()

    row = await _db_or_503("read source metadata", store.get_source(source_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Source not found")

    return _source_response_from_doc(row)
