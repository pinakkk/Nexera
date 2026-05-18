"""WorkOS JWT authentication utilities.

Extracts `user_id` from the WorkOS access token sent by the frontend
in the `Authorization: Bearer <token>` header.

WorkOS access tokens are standard RS256 JWTs. The `sub` claim contains
the WorkOS user ID (e.g. 'user_01JXXX...').

For production, full JWKS verification should be added. For now we decode
without signature verification since the session is already validated
server-side by AuthKit's middleware on the Next.js layer.
"""

from __future__ import annotations

import logging
from typing import Optional, TypedDict

import jwt
from fastapi import HTTPException, Request

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

    try:
        # Decode without signature verification.
        # Session validity is enforced by WorkOS AuthKit middleware on the
        # Next.js layer. For high-security operations, add JWKS verification:
        # https://workos.com/docs/user-management/sessions/verifying-sessions
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


def get_actor_scope_filter(actor: RequestActor) -> dict[str, str]:
    """Build a Mongo query filter that scopes records to the current actor."""
    if actor["user_id"]:
        return {"user_id": actor["user_id"]}
    if actor["session_id"]:
        return {"session_id": actor["session_id"]}
    return {"_id": "__no_actor__"}
