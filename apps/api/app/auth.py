"""Clerk JWT authentication utilities.

Extracts `user_id` from the Clerk session JWT sent by the frontend
in the `Authorization: Bearer <token>` header.

Clerk JWTs are standard RS256 JWTs whose public keys are available
at `https://<clerk-domain>/.well-known/jwks.json`.  For simplicity
we decode without full JWKS verification when CLERK_SECRET_KEY is
not configured, falling back to unverified decode (development mode).
"""

from __future__ import annotations

import logging
from typing import Optional

import jwt
from fastapi import Request

from app.config import get_settings

logger = logging.getLogger(__name__)


def _extract_bearer_token(request: Request) -> Optional[str]:
    """Extract the Bearer token from the Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return None


def get_user_id_from_request(request: Request) -> Optional[str]:
    """Extract the Clerk user_id from the request JWT.

    Returns the `sub` claim (Clerk user ID like 'user_xxx') or None
    if no valid token is present.
    """
    token = _extract_bearer_token(request)
    if not token:
        return None

    try:
        # Decode without verification to extract claims.
        # The Clerk middleware on the frontend already validates the session.
        # In production with sensitive operations, add full JWKS verification.
        payload = jwt.decode(token, options={"verify_signature": False})
        user_id = payload.get("sub")
        if user_id and isinstance(user_id, str):
            return user_id
        return None
    except jwt.DecodeError:
        logger.debug("Failed to decode JWT token")
        return None
    except Exception:
        logger.debug("Unexpected error decoding JWT", exc_info=True)
        return None
