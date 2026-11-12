from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    hf_nli_model: str = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
    hf_nli_device: str = "auto"
    hf_nli_batch_size: int = 8
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_secret_key: str = ""
    supabase_table: str = "analyses"
    cors_origins: str = "http://localhost:3000"
    model_config = SettingsConfigDict(env_file=Path(__file__).with_name(".env"), extra="ignore", case_sensitive=False)


settings = Settings()
