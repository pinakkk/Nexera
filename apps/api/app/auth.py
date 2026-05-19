"""Supabase JWT authentication utilities.

Extracts `user_id` from the Supabase access token sent by the frontend
in the `Authorization: Bearer <token>` header.

Supabase access tokens are HS256 JWTs signed with the project's JWT
secret (SUPABASE_JWT_SECRET). The `sub` claim holds the Supabase user
UUID. The signature, expiry, and audience are fully verified here so a
forged or expired token cannot impersonate a user.
"""

from __future__ import annotations

import logging
from typing import Optional, TypedDict

import jwt
from fastapi import HTTPException, Request

from app.config import get_settings

logger = logging.getLogger(__name__)

ANONYMOUS_SESSION_HEADER = "X-Anonymous-Session-ID"
ANONYMOUS_SESSION_QUERY_PARAM = "anonymous_session_id"
ACCESS_TOKEN_QUERY_PARAM = "access_token"


class RequestActor(TypedDict):
    user_id: str | None
    session_id: str | None
    is_authenticated: bool


def _extract_bearer_token(request: Request) -> Optional[str]:
    """Extract the Bearer token from the Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    query_token = request.query_params.get(ACCESS_TOKEN_QUERY_PARAM, "").strip()
    if query_token:
        return query_token
    return None


def get_user_id_from_request(request: Request) -> Optional[str]:
    """Extract the WorkOS user_id (sub claim) from the request JWT.

    Returns the `sub` claim (WorkOS user ID like 'user_01JXXX...') or None
    if no valid token is present.
    """
    token = _extract_bearer_token(request)
    if not token:
        return None

    settings = get_settings()
    if not settings.SUPABASE_JWT_SECRET:
        logger.error(
            "SUPABASE_JWT_SECRET is not configured; cannot verify access tokens"
        )
        return None

    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience=settings.SUPABASE_JWT_AUDIENCE,
        )
        user_id = payload.get("sub")
        if user_id and isinstance(user_id, str):
            return user_id
        return None
    except jwt.ExpiredSignatureError:
        logger.debug("Access token expired")
        return None
    except jwt.InvalidTokenError:
        logger.debug("Invalid access token", exc_info=True)
        return None
    except Exception:
        logger.debug("Unexpected error decoding JWT", exc_info=True)
        return None


def get_anonymous_session_id_from_request(request: Request) -> Optional[str]:
    """Return a browser-scoped anonymous session id from header or query param."""
    header_value = request.headers.get(ANONYMOUS_SESSION_HEADER, "").strip()
    if header_value:
        return header_value[:128]

    query_value = request.query_params.get(ANONYMOUS_SESSION_QUERY_PARAM, "").strip()
    if query_value:
        return query_value[:128]

    return None


def get_request_actor(request: Request) -> RequestActor:
    """Resolve the signed-in user or anonymous browser session for this request."""
    user_id = get_user_id_from_request(request)
    session_id = None if user_id else get_anonymous_session_id_from_request(request)
    return {
        "user_id": user_id,
        "session_id": session_id,
        "is_authenticated": bool(user_id),
    }


def require_request_actor(request: Request) -> RequestActor:
    """Require either an authenticated user or an anonymous browser session id."""
    actor = get_request_actor(request)
    if actor["user_id"] or actor["session_id"]:
        return actor
    raise HTTPException(
        status_code=401,
        detail=(
            "Missing authentication context. Sign in or send "
            f"{ANONYMOUS_SESSION_HEADER} for anonymous usage."
        ),
    )
