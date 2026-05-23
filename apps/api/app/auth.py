"""Supabase JWT authentication utilities.

Extracts `user_id` from the Supabase access token sent by the frontend
in the `Authorization: Bearer <token>` header.

Modern Supabase projects (those issuing `sb_publishable_*` API keys) sign
access tokens with an asymmetric algorithm (RS256 / ES256) and publish the
public keys via JWKS at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
Legacy projects sign with HS256 using a shared secret.

We support both: when `SUPABASE_URL` is set, we fetch and cache the JWKS
and verify using the key whose `kid` matches the token header. When the
algorithm is HS256 (legacy) we fall back to `SUPABASE_JWT_SECRET`. The
signature, expiry, and audience are fully verified in both paths so a
forged or expired token cannot impersonate a user.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional, TypedDict

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from app.config import get_settings

logger = logging.getLogger(__name__)

ANONYMOUS_SESSION_HEADER = "X-Anonymous-Session-ID"
ANONYMOUS_SESSION_QUERY_PARAM = "anonymous_session_id"
ACCESS_TOKEN_QUERY_PARAM = "access_token"

# JWKS client cache (one per SUPABASE_URL). PyJWKClient internally caches
# the fetched keys with its own TTL; we just avoid recreating the client.
_jwks_lock = threading.Lock()
_jwks_clients: dict[str, PyJWKClient] = {}
_jwks_url_failed_at: dict[str, float] = {}
_JWKS_FAILURE_BACKOFF_SECONDS = 30.0


class RequestActor(TypedDict):
    user_id: str | None
    session_id: str | None
    is_authenticated: bool


def _extract_bearer_token(request: Request) -> Optional[str]:
    """Extract the Bearer token from the Authorization header or query."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    query_token = request.query_params.get(ACCESS_TOKEN_QUERY_PARAM, "").strip()
    if query_token:
        return query_token
    return None


def _jwks_url_for(supabase_url: str) -> str:
    return f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


def _get_jwks_client(supabase_url: str) -> Optional[PyJWKClient]:
    """Return a cached PyJWKClient for the project, or None on persistent failure."""
    jwks_url = _jwks_url_for(supabase_url)
    with _jwks_lock:
        client = _jwks_clients.get(jwks_url)
        if client is not None:
            return client
        last_failure = _jwks_url_failed_at.get(jwks_url)
        if last_failure and (time.monotonic() - last_failure) < _JWKS_FAILURE_BACKOFF_SECONDS:
            return None
        try:
            client = PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
            _jwks_clients[jwks_url] = client
            _jwks_url_failed_at.pop(jwks_url, None)
            return client
        except Exception:
            logger.warning("Failed to initialize JWKS client for %s", jwks_url, exc_info=True)
            _jwks_url_failed_at[jwks_url] = time.monotonic()
            return None


def _decode_with_jwks(token: str, header: dict[str, Any], audience: str, supabase_url: str) -> Optional[dict[str, Any]]:
    client = _get_jwks_client(supabase_url)
    if client is None:
        return None
    try:
        signing_key = client.get_signing_key_from_jwt(token)
    except Exception as exc:
        logger.warning("Could not resolve JWKS signing key: %s", exc)
        return None
    alg = header.get("alg") or "RS256"
    try:
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=[alg],
            audience=audience,
        )
    except jwt.ExpiredSignatureError:
        logger.warning("Access token expired")
        return None
    except jwt.InvalidAudienceError:
        logger.warning("Invalid token audience; expected '%s'", audience)
        return None
    except jwt.InvalidSignatureError:
        logger.warning("Invalid token signature (JWKS path)")
        return None
    except jwt.InvalidTokenError as exc:
        logger.warning("Invalid access token (JWKS path): %s", exc)
        return None


def _decode_with_hs256(token: str, audience: str, secret: str) -> Optional[dict[str, Any]]:
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=audience,
        )
    except jwt.ExpiredSignatureError:
        logger.warning("Access token expired")
        return None
    except jwt.InvalidAudienceError:
        logger.warning("Invalid token audience; expected '%s'", audience)
        return None
    except jwt.InvalidSignatureError:
        logger.warning(
            "Invalid token signature — SUPABASE_JWT_SECRET likely does not match "
            "the Supabase project that issued this token"
        )
        return None
    except jwt.InvalidTokenError as exc:
        logger.warning("Invalid access token (HS256 path): %s", exc)
        return None


def get_user_id_from_request(request: Request) -> Optional[str]:
    """Extract the Supabase user_id (sub claim) from the request JWT.

    Returns the `sub` claim (Supabase user UUID) or None if no valid
    token is present.
    """
    token = _extract_bearer_token(request)
    if not token:
        return None

    settings = get_settings()

    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        logger.warning("Malformed token header: %s", exc)
        return None

    alg = (header.get("alg") or "").upper()
    payload: Optional[dict[str, Any]] = None

    if alg and alg != "HS256":
        if not settings.SUPABASE_URL:
            logger.error(
                "Received %s token but SUPABASE_URL is not configured; cannot verify",
                alg,
            )
            return None
        payload = _decode_with_jwks(
            token, header, settings.SUPABASE_JWT_AUDIENCE, settings.SUPABASE_URL
        )
    else:
        # HS256 — prefer the shared secret. If the project has migrated to
        # asymmetric signing but a stale HS256 token is still in flight, try
        # JWKS as a secondary check.
        if settings.SUPABASE_JWT_SECRET:
            payload = _decode_with_hs256(
                token, settings.SUPABASE_JWT_AUDIENCE, settings.SUPABASE_JWT_SECRET
            )
        if payload is None and settings.SUPABASE_URL:
            payload = _decode_with_jwks(
                token, header, settings.SUPABASE_JWT_AUDIENCE, settings.SUPABASE_URL
            )
        if payload is None and not settings.SUPABASE_JWT_SECRET and not settings.SUPABASE_URL:
            logger.error(
                "Neither SUPABASE_URL nor SUPABASE_JWT_SECRET is configured; "
                "cannot verify access tokens"
            )
            return None

    if not payload:
        return None

    user_id = payload.get("sub")
    if user_id and isinstance(user_id, str):
        return user_id
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
