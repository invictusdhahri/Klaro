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

    SUPABASE_URL: str = "http://127.0.0.1:54321"
    SUPABASE_SERVICE_ROLE_KEY: str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

    CLAUDE_HAIKU: str = "claude-haiku-4-5-20251001"
    CLAUDE_SONNET: str = "claude-sonnet-4-6"

    # Tavily Search API — optional, used by Layer 3 consistency check
    # If not set, web search calls are skipped gracefully.
    TAVILY_API_KEY: str | None = None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
