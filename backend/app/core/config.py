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
    credential_encryption_key: str = ""

    # 编排（对应 PRD 兜底机制）
    max_iterations: int = 20
    node_timeout_ms: int = 30_000
    task_timeout_ms: int = 300_000
    route_confidence_threshold: float = 0.6

    # 会话
    conversation_idle_timeout_min: int = 60
    max_context_messages: int = 40

    # ---- 模型网关（M2）----
    # provider: openai_compatible / mock
    # 未配置 base_url 或 api_key 时自动落到 mock（模板回显），保证离线可跑
    llm_provider: str = "openai_compatible"
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_temperature: float = 0.7
    llm_max_tokens: int = 1024
    llm_timeout_s: float = 60.0
    # 降级链：主模型不可用时依次尝试（逗号分隔模型名，最后兜底 mock）
    llm_fallback_models: str = ""

    # ---- Embedding（知识库 RAG）----
    # 未配置时使用确定性哈希伪向量，仅用于开发与测试
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 256
    embedding_timeout_s: float = 30.0

    # ---- RAG ----
    rag_top_k: int = 4
    rag_chunk_size: int = 500
    rag_chunk_overlap: int = 80
    rag_min_score: float = 0.15

    @property
    def llm_ready(self) -> bool:
        """是否具备调用真实 LLM 的条件（否则回落 mock）。"""
        return bool(self.llm_base_url and self.llm_api_key)

    @property
    def embedding_ready(self) -> bool:
        return bool(self.embedding_base_url and self.embedding_api_key)

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()
