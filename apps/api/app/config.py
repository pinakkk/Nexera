"""Application configuration via environment variables using pydantic-settings."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central configuration loaded from environment variables / .env file."""

    # ── LLM (Groq) ──────────────────────────────────────────────────────────
    GROQ_API_KEY: str = ""
    GROQ_FAST_MODEL: str = "llama-3.1-8b-instant"
    GROQ_SMART_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_AUTO_SELECT_BEST_LLAMA: bool = True

    # ── Web search (Tavily) ──────────────────────────────────────────────────
    TAVILY_API_KEY: str = ""
    SEARCH_MAX_RESULTS: int = 5

    # ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+psycopg://<user>:<password>@<host>/<db>?sslmode=require"
    DATABASE_URL_SYNC: str = "postgresql://<user>:<password>@<host>/<db>?sslmode=require"
    DB_STARTUP_RETRIES: int = 5
    DB_STARTUP_RETRY_DELAY_SECONDS: float = 2.0

    # ── Redis (optional – used for caching / pub-sub) ────────────────────────
    REDIS_URL: str | None = None

    # ── CORS ─────────────────────────────────────────────────────────────────
    CORS_ORIGINS: str = "http://localhost:3000"

    # ── Rate limiting ────────────────────────────────────────────────────────
    RATE_LIMIT_PER_MINUTE: int = 30
    RATE_LIMIT_RUNS_PER_MINUTE: int = 5

    # ── Agent behaviour ──────────────────────────────────────────────────────
    MAX_ITERATIONS: int = 3
    FETCH_TIMEOUT_SECONDS: int = 15
    INTEGRATION_CHECK_ON_STARTUP: bool = True
    INTEGRATION_CHECK_TIMEOUT_SECONDS: float = 12.0

    # ── Optional: Cohere reranker ────────────────────────────────────────────
    COHERE_API_KEY: str | None = None

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    @property
    def cors_origin_list(self) -> list[str]:
        """Return CORS origins as a list split on commas."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached singleton of the application settings."""
    return Settings()
