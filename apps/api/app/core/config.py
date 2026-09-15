"""Application settings loaded from environment (pydantic-settings)."""

from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+asyncpg://gmov:gmov_dev_password@localhost:5432/gmov"
    )
    redis_url: str = Field(default="redis://localhost:6379/0")

    jwt_secret: str = Field(default="dev-only-insecure-secret-change-me-please")
    jwt_algorithm: str = Field(default="HS256")
    access_token_expire_minutes: int = Field(default=30)
    refresh_token_expire_days: int = Field(default=30)

    nguonc_base_url: str = Field(default="https://phim.nguonc.com/api")
    nguonc_timeout_seconds: int = Field(default=10)
    cache_ttl_seconds: int = Field(default=3600)

    cors_origins: Annotated[list[str], NoDecode] = Field(
        default=["http://localhost:3000"]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip() for o in value.split(",") if o.strip()]
        return value


settings = Settings()
