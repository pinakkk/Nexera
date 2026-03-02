"""Validate Groq and Tavily API keys directly from apps/api/.env."""

from __future__ import annotations

import asyncio

from dotenv import dotenv_values
import groq
from tavily import TavilyClient


def _key_state(name: str, value: str) -> str:
    if not value:
        return f"{name}: MISSING"
    return f"{name}: SET (len={len(value)})"


async def _check_groq(api_key: str) -> bool:
    if not api_key:
        print("Groq: skipped (missing key)")
        return False
    try:
        client = groq.AsyncGroq(api_key=api_key)
        resp = await asyncio.wait_for(client.models.list(), timeout=12)
        models = [m.id for m in resp.data if isinstance(getattr(m, "id", None), str)]
        llamas = [m for m in models if "llama" in m.lower()]
        print(f"Groq: OK (models={len(models)}, llama_models={len(llamas)})")
        if llamas:
            print(f"Groq: sample llama models: {llamas[:5]}")
        return True
    except Exception as exc:
        print(f"Groq: FAILED ({exc})")
        return False


async def _check_tavily(api_key: str) -> bool:
    if not api_key:
        print("Tavily: skipped (missing key)")
        return False

    def _probe() -> dict:
        client = TavilyClient(api_key=api_key)
        return client.search(query="AI agent security", max_results=1, search_depth="basic")

    try:
        res = await asyncio.wait_for(asyncio.to_thread(_probe), timeout=12)
        rows = res.get("results", []) if isinstance(res, dict) else []
        first_url = rows[0].get("url") if rows else None
        print(f"Tavily: OK (results={len(rows)}, first_url={first_url})")
        return True
    except Exception as exc:
        print(f"Tavily: FAILED ({exc})")
        return False


async def main() -> int:
    env = dotenv_values(".env")
    groq_key = str(env.get("GROQ_API_KEY") or "").strip()
    tavily_key = str(env.get("TAVILY_API_KEY") or "").strip()

    print(_key_state("GROQ_API_KEY", groq_key))
    print(_key_state("TAVILY_API_KEY", tavily_key))

    groq_ok, tavily_ok = await asyncio.gather(
        _check_groq(groq_key),
        _check_tavily(tavily_key),
    )

    if groq_ok and tavily_ok:
        print("Integration check: SUCCESS")
        return 0

    print("Integration check: FAILED")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
