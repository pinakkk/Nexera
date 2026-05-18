"""FastAPI router for memory endpoints."""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth import get_request_actor
from app.services.memory import get_memory_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/memory", tags=["memory"])


class TrustedSourceCreate(BaseModel):
    domain: str
    label: Optional[str] = None
    trust_level: float = 1.0


@router.get("/")
async def list_memories(
    request: Request,
    category: Optional[str] = None,
    limit: int = 50,
):
    """List memories for the authenticated user."""
    actor = get_request_actor(request)
    user_id = actor["user_id"]
    try:
        service = get_memory_service()
        if not service.enabled or not user_id:
            return {"memories": []}
        memories = await service.list_memories(user_id, category=category, limit=limit)
        return {"memories": memories}
    except Exception as e:
        logger.warning("Memory list failed: %s", e)
        return {"memories": []}


@router.delete("/{memory_id}")
async def delete_memory(request: Request, memory_id: str):
    """Delete a specific memory."""
    actor = get_request_actor(request)
    user_id = actor["user_id"]
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to manage long-term memory.")
    service = get_memory_service()
    deleted = await service.delete_memory(user_id, memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"deleted": True}


@router.get("/stats")
async def get_memory_stats(request: Request):
    """Get memory statistics for the authenticated user."""
    actor = get_request_actor(request)
    user_id = actor["user_id"]
    try:
        service = get_memory_service()
        if not service.enabled or not user_id:
            return {"total": 0, "by_category": {}}
        stats = await service.get_stats(user_id)
        return stats
    except Exception as e:
        logger.warning("Memory stats failed: %s", e)
        return {"total": 0, "by_category": {}}


@router.post("/trusted-sources")
async def add_trusted_source(request: Request, body: TrustedSourceCreate):
    """Add a trusted source domain."""
    actor = get_request_actor(request)
    user_id = actor["user_id"]
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to save trusted sources.")
    service = get_memory_service()
    source = await service.add_trusted_source(
        user_id,
        domain=body.domain,
        label=body.label,
        trust_level=body.trust_level,
    )
    return source


@router.get("/trusted-sources")
async def list_trusted_sources(request: Request):
    """List all trusted sources for the authenticated user."""
    actor = get_request_actor(request)
    user_id = actor["user_id"]
    try:
        service = get_memory_service()
        if not service.enabled or not user_id:
            return {"sources": []}
        sources = await service.list_trusted_sources(user_id)
        return {"sources": sources}
    except Exception as e:
        logger.warning("Trusted sources list failed: %s", e)
        return {"sources": []}


@router.delete("/trusted-sources/{source_id}")
async def remove_trusted_source(request: Request, source_id: str):
    """Remove a trusted source."""
    actor = get_request_actor(request)
    user_id = actor["user_id"]
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to manage trusted sources.")
    service = get_memory_service()
    removed = await service.remove_trusted_source(user_id, source_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Trusted source not found")
    return {"deleted": True}
