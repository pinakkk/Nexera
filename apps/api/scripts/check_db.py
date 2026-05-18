"""Validate Supabase Postgres connectivity using the app's async engine."""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import text

from app.db.database import engine


async def _check() -> bool:
    if engine is None:
        print("Supabase check: skipped (engine is None — ALLOW_START_WITHOUT_DB=true?)")
        return False
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        print("Supabase OK")
        return True
    except Exception as exc:  # pragma: no cover - network dependent
        print(f"Supabase check failed: {exc}")
        return False


if __name__ == "__main__":
    ok = asyncio.run(_check())
    sys.exit(0 if ok else 1)
