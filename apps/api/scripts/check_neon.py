"""Neon/Postgres connectivity diagnostics for local development.

Run from `apps/api`:
    python scripts/check_neon.py
"""

from __future__ import annotations

import socket
from urllib.parse import urlparse

from dotenv import dotenv_values


def _print(msg: str) -> None:
    print(msg, flush=True)


def _load_database_url() -> str:
    env = dotenv_values(".env")
    url = str(env.get("DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is missing in apps/api/.env")
    return url


def _extract_host_port(url: str) -> tuple[str, int]:
    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or 5432
    if not host:
        raise RuntimeError("DATABASE_URL has no hostname")
    return host, port


def _dns_check(host: str) -> None:
    _print(f"[1/3] Resolving DNS for {host} ...")
    infos = socket.getaddrinfo(host, None)
    ips = sorted({item[4][0] for item in infos})
    _print(f"      OK: {', '.join(ips)}")


def _tcp_check(host: str, port: int) -> None:
    _print(f"[2/3] Testing TCP connectivity to {host}:{port} ...")
    with socket.create_connection((host, port), timeout=5):
        pass
    _print("      OK: TCP port is reachable")


def _query_check(url: str) -> None:
    _print("[3/3] Running SQL probe (SELECT 1) via psycopg ...")
    import psycopg

    with psycopg.connect(url, connect_timeout=8) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            row = cur.fetchone()
            _print(f"      OK: query result = {row}")


def main() -> int:
    try:
        url = _load_database_url()
        host, port = _extract_host_port(url)
        _dns_check(host)
        _tcp_check(host, port)
        _query_check(url.replace("+psycopg", ""))
    except Exception as exc:
        _print(f"\nFAILED: {exc}")
        _print("\nTry these fixes:")
        _print("1) Regenerate pooled Neon connection string from Neon dashboard.")
        _print("2) Validate host manually: nslookup <neon-host>")
        _print("3) On macOS set DNS: networksetup -setdnsservers Wi-Fi 1.1.1.1 8.8.8.8")
        _print(
            "4) Flush DNS cache: sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"
        )
        _print("5) Disable VPN/proxy temporarily and retry.")
        return 1

    _print("\nSUCCESS: Neon connectivity is healthy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
