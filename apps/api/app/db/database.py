"""Async SQLAlchemy engine, session factory, and declarative base."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from urllib.parse import urlparse

from sqlalchemy import text

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Declarative base class for all ORM models."""


def _build_engine() -> AsyncEngine | None:
    """Build the async engine for SQL backends.

    When ``ALLOW_START_WITHOUT_DB=true`` we intentionally skip engine
    initialization so API startup is decoupled from external DB connectivity.
    """
    settings = get_settings()
    if settings.ALLOW_START_WITHOUT_DB:
        logger.warning("Skipping SQL engine setup because ALLOW_START_WITHOUT_DB=true")
        return None
    url = settings.DATABASE_URL
    if not url:
        logger.warning("DATABASE_URL is empty; SQL engine not initialized")
        return None

    connect_args: dict[str, object] = {}
    # Supabase's connection pooler (pgBouncer, port 6543, transaction mode)
    # is incompatible with asyncpg's prepared-statement cache. Detect the
    # pooler host and disable statement caching so either the direct
    # (5432) or pooled (6543) connection string works unchanged.
    is_asyncpg = "+asyncpg" in url
    is_pooler = "pooler.supabase.com" in url or ":6543" in url
    if is_asyncpg and is_pooler:
        connect_args["statement_cache_size"] = 0
        logger.info("Supabase pooler detected; disabling asyncpg statement cache")

    return create_async_engine(
        url,
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


engine: AsyncEngine | None = _build_engine()

async_session_factory: async_sessionmaker[AsyncSession] | None = (
    async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    if engine is not None
    else None
)


def _db_host_from_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname or "unknown-host"


def _db_url_without_credentials(url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname is None:
        return url
    auth_host = parsed.hostname
    if parsed.port:
        auth_host = f"{auth_host}:{parsed.port}"
    return parsed._replace(netloc=auth_host).geturl()


async def ensure_database_ready() -> None:
    """Retry DB connectivity before running startup DDL."""
    if engine is None:
        return

    settings = get_settings()
    retries = max(1, int(settings.DB_STARTUP_RETRIES))
    delay = max(0.0, float(settings.DB_STARTUP_RETRY_DELAY_SECONDS))
    db_host = _db_host_from_url(settings.DATABASE_URL)

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            if attempt > 1:
                logger.info("Database became reachable on attempt %d/%d", attempt, retries)
            return
        except Exception as exc:  # pragma: no cover - network dependent
            last_error = exc
            logger.warning(
                "Database check failed (%d/%d). host=%s error=%s",
                attempt,
                retries,
                db_host,
                exc,
            )
            if attempt < retries:
                await asyncio.sleep(delay)

    safe_url = _db_url_without_credentials(settings.DATABASE_URL)
    raise RuntimeError(
        "Unable to connect to configured SQL database after startup retries.\n"
        f"- Host: {db_host}\n"
        f"- URL (credentials hidden): {safe_url}\n"
        "- Check that DATABASE_URL is correct and reachable.\n"
        "- On macOS, test DNS with: nslookup <db-host>\n"
        "- If DNS fails, set DNS servers to 1.1.1.1 and 8.8.8.8, then flush cache:\n"
        "  sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder\n"
        "- If using VPN/proxy, disable it temporarily and retry.\n"
        f"- Last error: {last_error}"
    ) from last_error


async def create_all_tables() -> None:
    """Create every table registered on ``Base.metadata``.

    This is intended for development and tests.  In production, prefer
    running Alembic migrations.
    """
    if engine is None:
        return

    await ensure_database_ready()
    async with engine.begin() as conn:  # type: AsyncConnection
        await conn.run_sync(Base.metadata.create_all)


async def drop_all_tables() -> None:
    """Drop every table registered on ``Base.metadata`` (tests only)."""
    if engine is None:
        return
    async with engine.begin() as conn:  # type: AsyncConnection
        await conn.run_sync(Base.metadata.drop_all)


def _get_session_factory() -> async_sessionmaker[AsyncSession]:
    if async_session_factory is None:
        raise RuntimeError(
            "SQLAlchemy session factory is not available because "
            "ALLOW_START_WITHOUT_DB=true."
        )
    return async_session_factory


@contextlib.asynccontextmanager
async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield an async database session and ensure it is closed afterwards.

    Usage::

        async with get_db() as session:
            result = await session.execute(select(Run))
    """
    session = _get_session_factory()()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """Yield an async database session for use with FastAPI ``Depends``.

    Unlike :func:`get_db`, this is a plain async generator (not a context
    manager), which is the form that FastAPI's dependency injection expects.
    """
    session = _get_session_factory()()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
