from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Brown-chat API"
    app_version: str = "0.1.0"
    app_env: Literal["local", "test", "staging", "production"] = "local"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    backend_cors_origins: list[AnyHttpUrl] = [AnyHttpUrl("http://localhost:3000")]
    database_url: str = "postgresql+asyncpg://brown_chat:brown_chat@localhost:5432/brown_chat"
    jwt_secret_key: str = "development-only-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    auth_cookie_name: str = "brown_chat_session"
    frontend_url: str = "http://localhost:3000"
    kakao_client_id: str = ""
    kakao_client_secret: str = ""
    kakao_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/kakao/callback"
    master_access_key_hash: str = ""
    master_guest_cookie_name: str = "brown_chat_guest_device"
    master_guest_cookie_max_age_days: int = 365
    chat_api_base_url: str = ""
    chat_api_key: str = ""
    chat_api_model: str = ""
    chat_api_timeout_seconds: float = 60.0
    chat_api_temperature: float = 0.7
    chat_context_message_limit: int = 3
    qdrant_url: str = ""
    qdrant_collection: str = "brown_chat_turns"
    embedding_api_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = "BAAI/bge-m3"
    embedding_vector_size: int = 1024
    embedding_timeout_seconds: float = 30.0
    chat_memory_top_k: int = 3
    chat_memory_score_threshold: float = 0.0
    upload_dir: str = "./uploads"
    upload_max_bytes: int = 10 * 1024 * 1024
    upload_max_attachments_per_message: int = 5
    attachment_text_max_characters: int = 30_000
    vlm_image_max_dimension: int = 2048
    vlm_image_max_bytes: int = 2 * 1024 * 1024
    vlm_image_jpeg_quality: int = 85
    vlm_image_temperature: float = 0.2
    whisper_api_base_url: str = ""
    whisper_language: str = "ko"
    whisper_timeout_seconds: float = 120.0
    voice_upload_max_bytes: int = 25 * 1024 * 1024
    chat_system_prompt: str = (
        "당신은 Brown-Chat의 친절하고 사려 깊은 AI 어시스턴트입니다. "
        "사용자가 다른 언어로 답해 달라고 명시적으로 요청하지 않는 한, "
        "모든 답변은 자연스러운 한국어로만 작성하세요. "
        "답변은 GitHub Flavored Markdown으로 작성하고 제목, 목록, 표, 인용문, "
        "인라인 코드와 코드 블록은 내용을 더 명확하게 만들 때만 사용하세요."
    )

    @property
    def docs_enabled(self) -> bool:
        return self.app_env != "production"

    @property
    def secure_cookies(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
