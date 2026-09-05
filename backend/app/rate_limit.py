"""Slowapi rate-limiter singleton.

A single ``Limiter`` instance shared across the app. Routers import ``limiter``
and decorate endpoints with ``@limiter.limit("60/minute")`` — the route handler
must accept ``request: fastapi.Request`` as a parameter so slowapi can read
the client IP.

Wired into the FastAPI app in ``app/main.py`` (``app.state.limiter = limiter``
plus the ``RateLimitExceeded`` exception handler).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address


def _client_key(request):
    """Rate-limit key that understands reverse proxies.

    Render / Vercel / nginx terminate TLS and forward the real client IP in
    X-Forwarded-For. Using only the socket address behind such a proxy lumps
    every visitor into ONE bucket — a single attacker could then 429-lock the
    whole userbase out of /auth/login. We take the left-most forwarded hop
    (set by our own trusted proxy) and fall back to the socket address for
    direct connections.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return get_remote_address(request)


limiter = Limiter(key_func=_client_key)
