"""Security middleware and SSRF protection utilities."""

from __future__ import annotations

import ipaddress
import socket
import time
from urllib.parse import urlparse

from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

# ---------------------------------------------------------------------------
# SSRF protection
# ---------------------------------------------------------------------------

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def is_private_ip(url: str) -> bool:
    """Return ``True`` if *url* resolves to a private / loopback IP address.

    Performs a DNS lookup to defeat DNS-rebinding style attacks where the
    hostname itself is public but resolves to an internal address.
    """
    parsed = urlparse(url)
    hostname = parsed.hostname
    if hostname is None:
        return True  # no host -> reject

    try:
        infos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror:
        return True  # cannot resolve -> treat as private/blocked

    for _family, _type, _proto, _canonname, sockaddr in infos:
        ip = ipaddress.ip_address(sockaddr[0])
        for network in _PRIVATE_NETWORKS:
            if ip in network:
                return True

    return False


def validate_url(url: str) -> bool:
    """Return ``True`` if *url* has an allowed scheme and does not point to a
    private IP address.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.hostname:
        return False
    if is_private_ip(url):
        return False
    return True


# ---------------------------------------------------------------------------
# Request size limit middleware
# ---------------------------------------------------------------------------

MAX_REQUEST_BODY_BYTES: int = 10 * 1024 * 1024  # 10 MB


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose ``content-length`` exceeds *max_bytes*."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BODY_BYTES) -> None:
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            if int(content_length) > self.max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"Request body too large. Maximum size is {self.max_bytes} bytes.",
                )
        return await call_next(request)


# ---------------------------------------------------------------------------
# Timeout middleware
# ---------------------------------------------------------------------------

DEFAULT_REQUEST_TIMEOUT_SECONDS: float = 120.0


class TimeoutMiddleware(BaseHTTPMiddleware):
    """Return 504 if the downstream handler takes longer than *timeout* seconds."""

    def __init__(self, app: ASGIApp, timeout: float = DEFAULT_REQUEST_TIMEOUT_SECONDS) -> None:
        super().__init__(app)
        self.timeout = timeout

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        import asyncio

        try:
            response = await asyncio.wait_for(call_next(request), timeout=self.timeout)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=504,
                detail=f"Request timed out after {self.timeout} seconds.",
            )
        return response


__all__ = [
    "is_private_ip",
    "validate_url",
    "RequestSizeLimitMiddleware",
    "TimeoutMiddleware",
]
