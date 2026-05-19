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

    # ── Academic APIs ────────────────────────────────────────────────────────
    SEMANTIC_SCHOLAR_API_KEY: str = ""
    SEMANTIC_SCHOLAR_ENDPOINT: str = "https://api.semanticscholar.org/graph/v1"
    ARXIV_ENDPOINT: str = "https://export.arxiv.org/api"

    # ── Database (Supabase — managed Postgres + pgvector) ────────────────────
    # Async SQLAlchemy connection string, e.g.
    # postgresql+asyncpg://postgres:PASSWORD@db.<project>.supabase.co:5432/postgres
    DATABASE_URL: str = ""
    DB_STARTUP_RETRIES: int = 5
    DB_STARTUP_RETRY_DELAY_SECONDS: float = 2.0
    ALLOW_START_WITHOUT_DB: bool = False

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

    # ── Parallel workers / cost guardrails ────────────────────────────────────
    MAX_FETCH_CONCURRENCY: int = 5
    MAX_SEARCH_QUERIES_PER_RUN: int = 10
    MAX_PAGES_PER_SUBQUESTION: int = 5
    MAX_AGENT_ITERS: int = 4

    # ── Interactive steering ─────────────────────────────────────────────────
    USER_INPUT_TIMEOUT_SECONDS: int = 300  # 5 min, then auto-proceed

    # ── Optional: Cohere reranker ────────────────────────────────────────────
    COHERE_API_KEY: str | None = None

    # ── Bright Data (primary web search) ─────────────────────────────────────
    BRIGHTDATA_API_KEY: str = ""
    BRIGHTDATA_SERP_ENDPOINT: str = "https://api.brightdata.com/serp"
    BRIGHTDATA_SCRAPER_ENDPOINT: str = "https://api.brightdata.com/scraping"

    # ── Research Gate ────────────────────────────────────────────────────────
    RESEARCH_GATE_ENABLED: bool = True

    # ── Model Routing (complexity-based) ─────────────────────────────────────
    # Override defaults per mode/role: MODEL_ROUTER_<MODE>_<ROLE>
    MODEL_ROUTER_FAST_WRITER: str = ""
    MODEL_ROUTER_FAST_EVALUATOR: str = ""
    MODEL_ROUTER_BALANCED_WRITER: str = ""
    MODEL_ROUTER_BALANCED_EVALUATOR: str = ""
    MODEL_ROUTER_DEEP_WRITER: str = ""
    MODEL_ROUTER_DEEP_EVALUATOR: str = ""

    # ── Safety Models ────────────────────────────────────────────────────────
    MODEL_SAFETY_PROMPT_GUARD: str = "meta-llama/llama-prompt-guard-2-86m"
    MODEL_SAFETY_CONTENT_GUARD: str = "meta-llama/llama-guard-4-12b"

    # ── Voice / STT ──────────────────────────────────────────────────────────
    STT_MODEL: str = "whisper-large-v3-turbo"
    STT_FALLBACK_MODEL: str = "whisper-large-v3"

    # ── Text-to-Speech (TTS) ─────────────────────────────────────────────────
    TTS_MODEL: str = "canopylabs/orpheus-v1-english"

    # ── Vision / Multimodal ──────────────────────────────────────────────────
    VISION_MODEL: str = "meta-llama/llama-4-scout-17b-16e-instruct"

    # ── PDF Reports ──────────────────────────────────────────────────────────
    REPORTS_DIR: str = "reports"

    # ── Embeddings (fastembed, ONNX) ─────────────────────────────────────
    EMBEDDING_DIMS: int = 384
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    EMBEDDING_CACHE_DIR: str = ".fastembed_cache"

    # ── Reranker (flashrank, ONNX, no API key) ───────────────────────────
    RERANKER_MODEL: str = "ms-marco-MiniLM-L-12-v2"
    RERANKER_TOP_N: int = 10
    RERANKER_ENABLED: bool = True

    # ── Persistent Memory ────────────────────────────────────────────────
    MEMORY_ENABLED: bool = True
    MEMORY_MAX_ENTRIES: int = 100
    MEMORY_TOP_K: int = 5

    # ── Authentication (Supabase Auth) ───────────────────────────────────────
    # Supabase access tokens are HS256 JWTs signed with the project's JWT
    # secret. The backend verifies the signature so a forged/expired token
    # cannot impersonate a user. Find it in the Supabase dashboard under
    # Project Settings → API → JWT Settings → JWT Secret.
    SUPABASE_JWT_SECRET: str = ""
    # Expected `aud` claim on Supabase user access tokens.
    SUPABASE_JWT_AUDIENCE: str = "authenticated"

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
