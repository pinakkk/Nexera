"""Per-request API key override from user-provided headers (BYOAPI).

The frontend sends user-configured API keys via custom headers so that
users can bring their own keys without modifying the backend .env.

Supported headers:
    X-Groq-Api-Key        → overrides GROQ_API_KEY
    X-Brightdata-Api-Key  → overrides BRIGHTDATA_API_KEY
    X-Tavily-Api-Key      → overrides TAVILY_API_KEY
    X-Cohere-Api-Key      → overrides COHERE_API_KEY
"""

from __future__ import annotations

import copy
from contextvars import ContextVar
from typing import Any

from fastapi import Request

from app.config import Settings, get_settings

# Context variable holding per-request settings override
_request_settings: ContextVar[Settings | None] = ContextVar(
    "_request_settings", default=None
)

# Header name → Settings field name
_HEADER_MAP: dict[str, str] = {
    "x-groq-api-key": "GROQ_API_KEY",
    "x-brightdata-api-key": "BRIGHTDATA_API_KEY",
    "x-tavily-api-key": "TAVILY_API_KEY",
    "x-cohere-api-key": "COHERE_API_KEY",
}


def apply_user_keys(request: Request) -> Settings:
    """Read user-provided API keys from request headers.

    Returns a (possibly modified) Settings instance.  If the user did not
    send any override headers the global singleton is returned as-is.
    """
    base = get_settings()
    overrides: dict[str, str] = {}

    for header_name, field_name in _HEADER_MAP.items():
        value = request.headers.get(header_name, "").strip()
        if value:
            overrides[field_name] = value

    if not overrides:
        _request_settings.set(None)
        return base

    # Create a shallow copy with overridden fields
    patched = base.model_copy(update=overrides)
    _request_settings.set(patched)
    return patched


def get_effective_settings() -> Settings:
    """Return the per-request settings if available, else the global settings."""
    override = _request_settings.get()
    return override if override is not None else get_settings()


def clear_request_settings() -> None:
    """Reset the per-request override (call at end of request)."""
    _request_settings.set(None)
