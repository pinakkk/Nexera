"""Startup diagnostics for external API integrations."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import groq
from tavily import TavilyClient

logger = logging.getLogger(__name__)


def _is_configured(value: str | None) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _redacted_info(name: str, value: str | None) -> str:
    if not _is_configured(value):
        return f"{name}=missing"
    return f"{name}=set(len={len(value or '')})"


async def log_api_integration_status(settings: Any) -> None:
    """Log Groq and Tavily connectivity/credential status.

    This is diagnostics-only and never raises.
    """
    timeout = float(getattr(settings, "INTEGRATION_CHECK_TIMEOUT_SECONDS", 12.0))
    groq_key = getattr(settings, "GROQ_API_KEY", "")
    tavily_key = getattr(settings, "TAVILY_API_KEY", "")

    logger.info(
        "[integration-check] %s %s",
        _redacted_info("GROQ_API_KEY", groq_key),
        _redacted_info("TAVILY_API_KEY", tavily_key),
    )

    await asyncio.gather(
        _check_groq(groq_key, timeout),
        _check_tavily(tavily_key, timeout),
    )


async def _check_groq(api_key: str, timeout: float) -> None:
    if not _is_configured(api_key):
        logger.warning("[integration-check] Groq skipped (missing API key)")
        return

    try:
        client = groq.AsyncGroq(api_key=api_key)
        response = await asyncio.wait_for(client.models.list(), timeout=timeout)
        models = getattr(response, "data", []) or []
        model_ids = [
            m.id for m in models if isinstance(getattr(m, "id", None), str)
        ]
        llama_ids = [m for m in model_ids if "llama" in m.lower()]
        logger.info(
            "[integration-check] Groq OK (models=%d llamas=%d sample=%s)",
            len(model_ids),
            len(llama_ids),
            llama_ids[:3],
        )
    except Exception as exc:
        logger.error("[integration-check] Groq FAILED: %s", exc)


async def _check_tavily(api_key: str, timeout: float) -> None:
    if not _is_configured(api_key):
        logger.warning("[integration-check] Tavily skipped (missing API key)")
        return

    def _run_probe() -> dict[str, Any]:
        client = TavilyClient(api_key=api_key)
        return client.search(query="AI agent security", max_results=1, search_depth="basic")

    try:
        result = await asyncio.wait_for(asyncio.to_thread(_run_probe), timeout=timeout)
        rows = result.get("results", []) if isinstance(result, dict) else []
        first_url = rows[0].get("url") if rows else None
        logger.info(
            "[integration-check] Tavily OK (results=%d first_url=%s)",
            len(rows),
            first_url,
        )
    except Exception as exc:
        logger.error("[integration-check] Tavily FAILED: %s", exc)
