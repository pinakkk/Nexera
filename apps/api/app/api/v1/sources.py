"""Source ingestion and metadata endpoints."""

from __future__ import annotations

import hashlib
import json as json_stdlib
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db_session
from app.db.models import Source
from app.schemas.sources import SourceCreate, SourceResponse

router = APIRouter(prefix="/sources")

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", "uploads"))
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _save_upload(upload: UploadFile) -> tuple[str, str]:
    """Save an uploaded file to disk.

    Returns (local_path, content_hash).
    """
    content = await upload.read()
    content_hash = hashlib.sha256(content).hexdigest()
    ext = Path(upload.filename or "file").suffix
    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / safe_name
    dest.write_bytes(content)
    return str(dest), content_hash


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/ingest", response_model=list[SourceResponse])
async def ingest_sources(
    files: list[UploadFile] | None = File(default=None),
    urls_json: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db_session),
) -> list[SourceResponse]:
    """Ingest sources from file uploads OR a JSON form field with URLs.

    For file uploads, use ``multipart/form-data`` with the ``files`` field.
    To send URLs alongside file uploads, include a ``urls_json`` form field
    containing a JSON-encoded list of URL strings.

    For URL-only ingestion without files, prefer the ``POST /ingest/urls``
    endpoint which accepts a plain JSON body.
    """
    created: list[Source] = []
    now = datetime.now(timezone.utc)

    # -- Handle uploaded files ------------------------------------------------
    if files:
        for upload in files:
            local_path, content_hash = await _save_upload(upload)
            source = Source(
                id=uuid.uuid4(),
                filename=upload.filename,
                content_type=upload.content_type,
                status="pending",
                created_at=now,
            )
            db.add(source)
            created.append(source)

    # -- Handle URLs passed as a form field -----------------------------------
    if urls_json:
        try:
            url_list: list[str] = json_stdlib.loads(urls_json)
            if not isinstance(url_list, list):
                raise TypeError("urls_json must be a JSON array")
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=422, detail=f"Invalid urls_json: {exc}")

        for url in url_list:
            source = Source(
                id=uuid.uuid4(),
                url=url,
                status="pending",
                created_at=now,
            )
            db.add(source)
            created.append(source)

    if not created:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one file upload or URL in urls_json.",
        )

    await db.commit()
    return [SourceResponse.model_validate(s) for s in created]


@router.post("/ingest/urls", response_model=list[SourceResponse])
async def ingest_urls(
    body: SourceCreate,
    db: AsyncSession = Depends(get_db_session),
) -> list[SourceResponse]:
    """Ingest sources from a JSON body containing URLs."""
    if not body.urls:
        raise HTTPException(status_code=422, detail="urls list must not be empty")

    created: list[Source] = []
    now = datetime.now(timezone.utc)

    for url in body.urls:
        source = Source(
            id=uuid.uuid4(),
            url=url,
            status="pending",
            created_at=now,
        )
        db.add(source)
        created.append(source)

    await db.commit()
    return [SourceResponse.model_validate(s) for s in created]


@router.get("/{source_id}", response_model=SourceResponse)
async def get_source(
    source_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> SourceResponse:
    """Return metadata for a single source."""
    try:
        parsed_id = uuid.UUID(source_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Source not found")

    stmt = select(Source).where(Source.id == parsed_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Source not found")

    return SourceResponse.model_validate(row)
