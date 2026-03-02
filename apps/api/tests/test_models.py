"""Tests for model listing endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_models_fallback_to_defaults(async_client: AsyncClient) -> None:
    """GET /v1/models returns configured defaults when no API key is set."""
    settings = SimpleNamespace(
        GROQ_API_KEY="",
        GROQ_FAST_MODEL="llama-fast",
        GROQ_SMART_MODEL="llama-smart",
    )

    with patch("app.api.v1.models.get_settings", return_value=settings):
        response = await async_client.get("/v1/models")

    assert response.status_code == 200
    data = response.json()
    assert "models" in data
    assert [m["id"] for m in data["models"]] == ["llama-fast", "llama-smart"]


@pytest.mark.asyncio
async def test_list_models_uses_groq_when_available(async_client: AsyncClient) -> None:
    """GET /v1/models returns models from Groq API when key is configured."""
    settings = SimpleNamespace(
        GROQ_API_KEY="test-key",
        GROQ_FAST_MODEL="llama-fast",
        GROQ_SMART_MODEL="llama-smart",
    )

    class _DummyModels:
        async def list(self):
            return SimpleNamespace(
                data=[
                    SimpleNamespace(id="llama-fast", owned_by="groq"),
                    SimpleNamespace(id="llama-vision", owned_by="groq"),
                    SimpleNamespace(id="llama-smart", owned_by="groq"),
                ]
            )

    class _DummyClient:
        def __init__(self, *args, **kwargs):  # noqa: D401, ANN002, ANN003
            self.models = _DummyModels()

    with (
        patch("app.api.v1.models.get_settings", return_value=settings),
        patch("app.api.v1.models.groq.AsyncGroq", _DummyClient),
    ):
        response = await async_client.get("/v1/models")

    assert response.status_code == 200
    models = response.json()["models"]
    assert len(models) == 3
    # Default models are sorted first
    assert models[0]["id"] in {"llama-fast", "llama-smart"}
    assert models[1]["id"] in {"llama-fast", "llama-smart"}
    assert models[2]["id"] == "llama-vision"
