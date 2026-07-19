from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Server-owned configuration loaded from cloud environment variables."""

    app_name: str = "Xiaohongshu AI API"
    app_version: str = "1.0.0"
    app_env: str = "production"
    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-3.5-flash"
    gemini_allowed_models: str = (
        "gemini-3.5-flash,gemini-2.5-flash,gemini-2.5-pro"
    )
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_models(self) -> set[str]:
        return {
            item.strip()
            for item in self.gemini_allowed_models.split(",")
            if item.strip()
        }

    @property
    def allowed_origins(self) -> list[str]:
        return [
            item.strip() for item in self.cors_origins.split(",") if item.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
