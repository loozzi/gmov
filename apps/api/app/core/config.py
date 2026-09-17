"""Application settings loaded from environment (pydantic-settings)."""

from typing import Annotated

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-insecure-secret-change-me-please"
DEV_POSTGRES_PASSWORD = "gmov_dev_password"
MIN_PROD_SECRET_LEN = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = Field(default="development")
    database_url: str = Field(
        default="postgresql+asyncpg://gmov:gmov_dev_password@localhost:5432/gmov"
    )
    redis_url: str = Field(default="redis://localhost:6379/0")
    postgres_password: str | None = Field(default=None)

    jwt_secret: str = Field(default=DEV_JWT_SECRET)
    jwt_algorithm: str = Field(default="HS256")
    access_token_expire_minutes: int = Field(default=30)
    refresh_token_expire_days: int = Field(default=30)

    max_profiles: int = Field(default=5, ge=1)
    pin_max_attempts: int = Field(default=5, ge=1)
    pin_window: int = Field(default=60, ge=1)

    trusted_proxies: Annotated[list[str], NoDecode] = Field(
        default=[
            "127.0.0.0/8",
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "::1",
        ]
    )

    nguonc_base_url: str = Field(default="https://phim.nguonc.com/api")
    nguonc_timeout_seconds: int = Field(default=10)
    cache_ttl_seconds: int = Field(default=3600)

    catalog_ttl_hours: int = Field(default=24, ge=1)
    catalog_refresh_interval_minutes: int = Field(default=360, ge=1)
    catalog_refresh_pages: int = Field(default=1, ge=1)

    recs_limit: int = Field(default=20, ge=1)
    recs_cache_ttl: int = Field(default=900, ge=1)
    popular_min_ratings: int = Field(default=3, ge=1)

    comment_report_hide_threshold: int = Field(default=3, ge=1)
    moderation_blocked_keywords: Annotated[list[str], NoDecode] = Field(default=[])

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default=[
            "http://localhost:3000",
            "http://localhost:3100",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3100",
        ]
    )

    @field_validator(
        "cors_origins", "trusted_proxies", "moderation_blocked_keywords", mode="before"
    )
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip() for o in value.split(",") if o.strip()]
        return value

    @model_validator(mode="after")
    def _enforce_prod_secrets(self) -> "Settings":
        if self.environment.strip().lower() != "production":
            return self
        bad_jwt = (
            not self.jwt_secret
            or self.jwt_secret == DEV_JWT_SECRET
            or len(self.jwt_secret) < MIN_PROD_SECRET_LEN
        )
        if bad_jwt:
            raise ValueError(
                "Refusing to start: JWT_SECRET is missing, still the dev default, "
                f"or shorter than {MIN_PROD_SECRET_LEN} chars in production. "
                "Generate one with scripts/gen-secrets.sh."
            )
        pg = self.postgres_password
        if (
            not pg
            or pg == DEV_POSTGRES_PASSWORD
            or len(pg) < MIN_PROD_SECRET_LEN
        ):
            raise ValueError(
                "Refusing to start: POSTGRES_PASSWORD is missing, still the dev "
                f"default, or shorter than {MIN_PROD_SECRET_LEN} chars in "
                "production. Generate one with scripts/gen-secrets.sh."
            )
        return self


def _load_settings() -> Settings:
    try:
        return Settings()
    except Exception as exc:
        # Fail fast with a clear message instead of booting insecure.
        raise SystemExit(f"FATAL config error: {exc}") from exc


settings = _load_settings()
