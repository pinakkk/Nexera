"""Shared pytest fixtures for the API test suite."""

from __future__ import annotations

import asyncio
import os
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Neon/Postgres URL required for DB-backed API tests.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if TEST_DATABASE_URL:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    os.environ["DATABASE_URL_SYNC"] = (
        TEST_DATABASE_URL.replace("+asyncpg", "").replace("+psycopg", "")
    )

from app.db.database import Base, get_db_session  # noqa: E402
import app.db.models  # noqa: E402,F401  -- ensure models are registered on Base
from app.main import app  # noqa: E402

# ---------------------------------------------------------------------------
# Engine & session factory scoped to the test session
# ---------------------------------------------------------------------------

if TEST_DATABASE_URL:
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
    )
    TestingSessionLocal = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
else:
    engine = None
    TestingSessionLocal = None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def event_loop():
    """Create a single event loop for the entire test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _setup_database():
    """Create all tables before tests, drop them after."""
    if engine is None:
        yield
        return

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a database session for a single test."""
    if TestingSessionLocal is None:
        pytest.skip(
            "Skipping API DB tests: set TEST_DATABASE_URL to a Neon/Postgres URL"
        )

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        await session.close()


@pytest_asyncio.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """HTTPX async client wired to the FastAPI app with the test DB session."""

    async def _override_get_db():
        yield db_session

    # Both runs.py and sources.py import get_db_session from database.py,
    # so a single override covers all routes.
    app.dependency_overrides[get_db_session] = _override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()
