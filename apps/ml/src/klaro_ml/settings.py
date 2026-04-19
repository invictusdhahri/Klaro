"""Environment-driven settings for the ML sidecar."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ML_ENV: str = "development"
    ML_PORT: int = 8000
    LOG_LEVEL: str = "INFO"
    ANTHROPIC_API_KEY: str | None = None

    CLAUDE_HAIKU: str = "claude-haiku-4-5-20251001"
    CLAUDE_SONNET: str = "claude-sonnet-4-6"

    # Supabase — needed to download files from Storage in the ML service
    SUPABASE_URL: str | None = None
    SUPABASE_SERVICE_ROLE_KEY: str | None = None

    # Tavily Search API — optional, used by Layer 3 consistency check
    # If not set, web search calls are skipped gracefully.
    TAVILY_API_KEY: str | None = None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
