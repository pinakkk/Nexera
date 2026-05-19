import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, engine_from_config
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import get_settings
from app.db.database import Base
from app.db import models  # noqa: F401 - ensure models are loaded

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Prefer the runtime DATABASE_URL (Supabase) over the static alembic.ini value
# so migrations always target the same database the app uses.
# Escape '%' as '%%' — set_main_option runs the value through ConfigParser
# interpolation, which otherwise chokes on URL-encoded passwords (e.g. %40).
_db_url = (get_settings().DATABASE_URL or "").strip()
if _db_url:
    config.set_main_option("sqlalchemy.url", _db_url.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    try:
        asyncio.get_running_loop()
        connectable = engine_from_config(
            config.get_section(config.config_ini_section, {}),
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
            url=(
                config.get_main_option("sqlalchemy.url")
                .replace("+asyncpg", "")
                .replace("+psycopg", "")
            ),
        )
        with connectable.connect() as connection:
            do_run_migrations(connection)
    except RuntimeError:
        asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
