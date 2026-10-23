# 后端工程结构设计

> 对应 PRD §2 技术栈、AGENTS.md §5 目录结构。定义 backend 模块职责、依赖注入、配置管理、分层架构。

---

## 1. 目录结构

```
backend/
├── alembic/                      # 数据库迁移
│   └── versions/
├── app/
│   ├── main.py                   # FastAPI 入口
│   ├── core/
│   │   ├── config.py             # 配置（pydantic-settings）
│   │   ├── security.py           # 鉴权、密钥、JWT
│   │   ├── tenant.py             # 租户上下文中间件
│   │   ├── logging.py            # 日志配置
│   │   └── deps.py               # 依赖注入
│   ├── api/
│   │   ├── v1/
│   │   │   ├── router.py         # 路由聚合
│   │   │   ├── tenants.py
│   │   │   ├── apps.py
│   │   │   ├── agents.py
│   │   │   ├── workflows.py
│   │   │   ├── conversations.py
│   │   │   ├── knowledge.py
│   │   │   ├── mcp.py
│   │   │   ├── skills.py
│   │   │   ├── models.py
│   │   │   └── api_keys.py
│   │   └── stream.py             # SSE/WS 流式端点
│   ├── graph/                    # LangGraph 编排
│   │   ├── state.py              # AgentState 定义
│   │   ├── builder.py            # 图构建工厂
│   │   ├── nodes/
│   │   │   ├── entry.py
│   │   │   ├── router.py         # 智能路由节点
│   │   │   ├── agent_node.py
│   │   │   ├── guard.py          # 输出校验
│   │   │   ├── fallback.py       # 降级
│   │   │   └── terminal.py       # 终态
│   │   ├── routing/
│   │   │   ├── base.py           # RouterStrategy 接口
│   │   │   ├── semantic.py
│   │   │   ├── rule.py
│   │   │   └── hybrid.py
│   │   └── checkpoint.py         # PostgresSaver 封装
│   ├── gateway/                  # 模型网关
│   │   ├── base.py               # LLM 抽象接口
│   │   ├── providers/            # openai / anthropic / qwen ...
│   │   ├── router.py             # 模型路由
│   │   └── meter.py              # 计量
│   ├── mcp/                      # MCP 集成
│   ├── skills/                   # Skill 加载与执行
│   ├── knowledge/                # 知识库 / RAG
│   │   ├── parser.py             # 文档解析
│   │   ├── chunker.py            # 切分
│   │   ├── embedder.py           # 向量化
│   │   └── retriever.py          # 检索
│   ├── models/                   # SQLAlchemy ORM 模型
│   ├── schemas/                  # Pydantic 请求/响应模型
│   ├── services/                 # 业务服务层
│   ├── middleware/               # 中间件（租户、鉴权、审计）
│   └── observability/
│       ├── tracer.py             # trace 埋点
│       └── metrics.py            # 指标
├── tests/
│   ├── unit/
│   ├── integration/
│   └── eval/                     # 评估数据集与脚本
├── pyproject.toml
└── .env.example
```

---

## 2. 分层架构与职责

```
API 层 (FastAPI 路由)
   │  参数校验、鉴权、序列化
   ▼
服务层 (services/)
   │  业务编排、事务边界
   ▼
领域层 (graph / gateway / knowledge / mcp / skills)
   │  核心能力实现
   ▼
数据层 (models / SQLAlchemy)
```

**依赖方向**：`api → services → domain → data`，禁止反向依赖。

---

## 3. 关键设计

### 3.1 租户上下文中间件

```python
@app.middleware("http")
async def tenant_context(request, call_next):
    tenant_id = extract_tenant(request)        # 从 header/token 解析
    # 注入到 SQLAlchemy 会话 + RLS
    async with session_scope(tenant_id) as db:
        request.state.db = db
        response = await call_next(request)
    return response
```

### 3.2 依赖注入

- 使用 FastAPI `Depends` + 自定义 provider。
- 数据库会话：`request.state.db`（请求级生命周期）。
- 图执行器：按 `workflow_version_id` 缓存编译后的图，避免每次请求重新编译。

### 3.3 配置管理

```python
class Settings(BaseSettings):
    database_url: str
    redis_url: str
    secret_key: str
    llm_providers: dict          # 各供应商配置（密钥从环境变量/密钥管理读取）
    max_iterations: int = 20
    node_timeout_ms: int = 30000
    route_confidence_threshold: float = 0.6

    class Config:
        env_file = ".env"
```

- 敏感配置（API Key）禁止硬编码，走环境变量或密钥管理服务（如 Vault/KMS）。
- 不同环境（dev/staging/prod）用不同 `.env`，禁止把生产密钥提交到仓库。

### 3.4 流式端点

- SSE 用 `StreamingResponse` + `media_type="text/event-stream"`。
- 图执行用 `graph.astream()` 逐事件 yield，包装成统一事件格式（见 api.md §4.2）。
- 隐藏返回在图中以 `hidden_responses` 字段产生，流式端点检测到后发 `event: hidden`。

### 3.5 异步与队列

- 短任务：同步/流式直连图执行。
- 长任务：投递消息队列（如 Redis Stream / Celery），Worker 消费，checkpoint 断点续跑。
- 每个 run 绑定独立 `thread_id`（= conversation_id），队列消息幂等。

---

## 4. 依赖清单（pyproject.toml 核心）

```
langgraph
langchain-core
langchain-openai        # 可替换为其他 provider
fastapi
uvicorn[standard]
sqlalchemy[asyncio]
asyncpg
alembic
pydantic
pydantic-settings
redis
psycopg / psycopg2-binary
```

> 具体 provider 包按需引入，通过 gateway 抽象层解耦，避免锁定单一厂商。

---

## 5. 测试策略

- **单元测试**：路由策略、状态 reducer、降级逻辑。
- **集成测试**：租户隔离、会话隔离、checkpoint 恢复。
- **评估测试**（`tests/eval/`）：黄金数据集跑图，断言任务成功率、工具准确率，接入 CI 门禁。
