from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Server-owned configuration loaded from cloud environment variables."""

    app_name: str = "Xiaohongshu AI API"
    app_version: str = "1.0.0"
    app_env: str = "production"
    tokenhub_api_key: SecretStr | None = None
    tokenhub_base_url: str = "https://tokenhub.tencentmaas.com/v1"
    tokenhub_model: str = "deepseek-v4-pro-202606"
    tokenhub_allowed_models: str = "deepseek-v4-pro-202606"
    tokenhub_timeout_seconds: float = 90.0
    tokenhub_search_source: str = "lite"
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
            for item in self.tokenhub_allowed_models.split(",")
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
