"""Sync database schema: drop & recreate new KG/verification tables to match current models.

This script only touches the NEW tables (kg_nodes, kg_edges, claims, verification_results).
It does NOT touch existing tables (runs, documents, chunks, etc.).

Usage:
    python scripts/sync_new_tables.py
"""

from __future__ import annotations

import asyncio
import sys
import os

# Ensure the app directory is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from app.db.database import engine, Base

# Import all models so Base.metadata is aware of them
import app.db.models  # noqa: F401


NEW_TABLES = ["verification_results", "claims", "kg_edges", "kg_nodes"]


async def main() -> None:
    print("Syncing new tables to configured SQL database...")
    print(f"Tables to sync: {NEW_TABLES}")

    async with engine.begin() as conn:
        # Check which tables exist
        for table_name in NEW_TABLES:
            result = await conn.execute(
                text(
                    "SELECT EXISTS ("
                    "  SELECT FROM information_schema.tables"
                    "  WHERE table_name = :name"
                    ")"
                ),
                {"name": table_name},
            )
            exists = result.scalar()
            if exists:
                print(f"  Dropping existing table: {table_name}")
                await conn.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
            else:
                print(f"  Table does not exist yet: {table_name}")

        # Now create all tables (only missing ones will be created)
        print("\nCreating all tables from ORM models...")
        await conn.run_sync(Base.metadata.create_all)

    print("\n✓ Database schema synced successfully!")
    print("  New tables created: kg_nodes, kg_edges, claims, verification_results")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
