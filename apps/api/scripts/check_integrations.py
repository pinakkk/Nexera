"""Validate API keys directly from apps/api/.env."""

from __future__ import annotations

import asyncio

from dotenv import dotenv_values
import groq


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

    try:
        from tavily import TavilyClient

        def _probe() -> dict:
            client = TavilyClient(api_key=api_key)
            return client.search(query="AI agent security", max_results=1, search_depth="basic")

        res = await asyncio.wait_for(asyncio.to_thread(_probe), timeout=12)
        rows = res.get("results", []) if isinstance(res, dict) else []
        first_url = rows[0].get("url") if rows else None
        print(f"Tavily: OK (results={len(rows)}, first_url={first_url})")
        return True
    except ImportError:
        print("Tavily: skipped (tavily-python not installed)")
        return False
    except Exception as exc:
        print(f"Tavily: FAILED ({exc})")
        return False


async def main() -> int:
    env = dotenv_values(".env")
    groq_key = str(env.get("GROQ_API_KEY") or "").strip()
    tavily_key = str(env.get("TAVILY_API_KEY") or "").strip()
    s2_key = str(env.get("SEMANTIC_SCHOLAR_API_KEY") or "").strip()

    print("── API Key Status ──")
    print(_key_state("GROQ_API_KEY", groq_key))
    print(_key_state("TAVILY_API_KEY", tavily_key))
    print(_key_state("SEMANTIC_SCHOLAR_API_KEY", s2_key))
    print()

    # Determine search provider
    if tavily_key:
        print("Search provider: Tavily")
        search_ok = await _check_tavily(tavily_key)
    else:
        print("WARNING: No search provider configured!")
        print("  Set TAVILY_API_KEY in .env")
        search_ok = False

    groq_ok = await _check_groq(groq_key)

    print()
    if groq_ok and search_ok:
        print("Integration check: SUCCESS ✓")
        return 0

    if groq_ok and not search_ok:
        print("Integration check: PARTIAL (Groq OK, no search provider)")
        return 1

    print("Integration check: FAILED ✗")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
