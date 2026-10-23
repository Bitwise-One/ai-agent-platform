"""全局配置：环境变量优先级高于默认值，敏感项禁止硬编码。"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # 应用
    app_name: str = "ai-agent-platform"
    env: str = "dev"
    debug: bool = True
    api_prefix: str = "/api/v1"

    # 数据库（生产 PostgreSQL；测试可切 sqlite+aiosqlite）
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/agent_platform"
    db_echo: bool = False
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # 安全
    secret_key: str = "dev-only-change-me"
    api_key_prefix: str = "ak"

    # 编排（对应 PRD 兜底机制）
    max_iterations: int = 20
    node_timeout_ms: int = 30_000
    task_timeout_ms: int = 300_000
    route_confidence_threshold: float = 0.6

    # 会话
    conversation_idle_timeout_min: int = 60
    max_context_messages: int = 40

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()
