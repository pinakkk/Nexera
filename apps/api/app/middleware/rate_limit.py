"""Rate-limiting middleware using slowapi.

Uses Redis as a backend when ``REDIS_URL`` is set in the environment;
otherwise falls back to an in-memory store.
"""

from __future__ import annotations

import os

from fastapi import Request, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

REDIS_URL: str | None = os.getenv("REDIS_URL")

if REDIS_URL:
    # Use Redis-backed storage
    limiter = Limiter(
        key_func=get_remote_address,
        storage_uri=REDIS_URL,
        default_limits=["60/minute"],
    )
else:
    # In-memory storage (single-process only)
    limiter = Limiter(
        key_func=get_remote_address,
        default_limits=["60/minute"],
    )

rate_limit_handler = _rate_limit_exceeded_handler

__all__ = ["limiter", "rate_limit_handler", "RateLimitExceeded"]
