"""Model listing endpoints."""

from __future__ import annotations

import logging

import groq
from fastapi import APIRouter
from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/models")


class ModelItem(BaseModel):
    id: str
    owned_by: str | None = None
    is_default: bool = False


class ModelListResponse(BaseModel):
    models: list[ModelItem]


def _configured_defaults() -> list[str]:
    settings = get_settings()
    values = [
        settings.GROQ_FAST_MODEL,
        settings.GROQ_SMART_MODEL,
    ]
    deduped: list[str] = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped


@router.get("", response_model=ModelListResponse)
async def list_models() -> ModelListResponse:
    """Return available Groq model IDs for frontend model picker."""
    settings = get_settings()
    defaults = _configured_defaults()
    default_set = set(defaults)

    if not settings.GROQ_API_KEY:
        return ModelListResponse(
            models=[
                ModelItem(id=model_id, is_default=True)
                for model_id in defaults
            ]
        )

    try:
        print(f"DEBUG GROQ KEY in /v1/models: '{settings.GROQ_API_KEY}'")
        client = groq.AsyncGroq(api_key=settings.GROQ_API_KEY)
        response = await client.models.list()
        ids_seen: set[str] = set()
        models: list[ModelItem] = []

        for model in response.data:
            if model.id in ids_seen:
                continue
            ids_seen.add(model.id)
            models.append(
                ModelItem(
                    id=model.id,
                    owned_by=getattr(model, "owned_by", None),
                    is_default=model.id in default_set,
                )
            )

        models.sort(key=lambda item: (0 if item.is_default else 1, item.id.lower()))
        return ModelListResponse(models=models)
    except Exception:
        logger.exception("Failed to list models from Groq API")
        return ModelListResponse(
            models=[
                ModelItem(id=model_id, is_default=True)
                for model_id in defaults
            ]
        )
