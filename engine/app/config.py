from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # Nessie serves plain HTTP, so it is reachable from here and nowhere else.
    nessie_base_url: str = "http://api.nessieisreal.com"
    nessie_api_key: str = ""

    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # Which customers row /customers/me (and everything downstream of it)
    # serves. See repository.fetch_current_customer for the full resolution
    # rule this backs.
    active_customer_id: str = ""
    # Without a Bearer token the engine answers 401. false brings back the
    # single-customer resolution above, for curl and local demos.
    engine_require_auth: bool = True

    engine_port: int = 8000
    # Comma-separated origins allowed to call the engine from a browser.
    engine_cors_origins: str = "*"


@lru_cache
def get_settings() -> Settings:
    return Settings()
