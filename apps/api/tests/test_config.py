"""Config guard + trusted-proxy IP tests (no DB needed)."""

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from app.core import ratelimit
from app.core.config import Settings


def _req(peer: str, xff: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff else []
    return Request({"type": "http", "headers": headers, "client": (peer, 12345)})


def test_client_ip_trusts_xff_only_behind_private_proxy():
    assert ratelimit.client_ip(_req("10.0.0.5", "203.0.113.9")) == "203.0.113.9"
    assert ratelimit.client_ip(_req("172.18.0.3", "203.0.113.9, 10.0.0.5")) == (
        "203.0.113.9"
    )


def test_client_ip_ignores_spoofed_xff_from_public_peer():
    assert ratelimit.client_ip(_req("203.0.113.9", "1.2.3.4")) == "203.0.113.9"
    assert ratelimit.client_ip(_req("198.51.100.7")) == "198.51.100.7"


def test_production_refuses_dev_secrets(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    with pytest.raises(ValidationError):
        Settings()


def test_production_refuses_short_secrets(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("JWT_SECRET", "too-short")
    monkeypatch.setenv("POSTGRES_PASSWORD", "also-short")
    with pytest.raises(ValidationError):
        Settings()


def test_app_exits_at_boot_with_dev_secrets(monkeypatch):
    """The import-time loader converts config errors into a hard SystemExit."""
    from app.core import config

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    with pytest.raises(SystemExit):
        config._load_settings()


def test_production_accepts_strong_secrets(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("JWT_SECRET", "x" * 64)
    monkeypatch.setenv("POSTGRES_PASSWORD", "y" * 64)
    assert Settings().environment == "production"


def test_development_allows_defaults(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert Settings().environment == "development"
