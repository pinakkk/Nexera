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
from typing import Optional

import jwt
from fastapi import Request

logger = logging.getLogger(__name__)


def _extract_bearer_token(request: Request) -> Optional[str]:
    """Extract the Bearer token from the Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
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
