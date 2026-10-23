# 后端（M1）

通用智能体平台后端：FastAPI + LangGraph + SQLAlchemy(async)。

## 快速开始（uv）

```bash
cd backend
uv sync                                  # 安装依赖（含 dev 组）
cp .env.example .env                     # 按需修改 DATABASE_URL
uv run python -m scripts.init_db         # 本地建表（sqlite 默认）
uv run uvicorn app.main:app --reload     # 启动，文档 http://127.0.0.1:8000/docs
```

测试与检查：

```bash
uv run pytest        # 15 个用例：路由 / 兜底终态 / 四层隔离
uv run ruff check app tests
```

## M1 已实现

| 能力 | 位置 | 说明 |
|---|---|---|
| 数据模型 | `app/models/` | 24 张表：租户/应用/Agent/工作流/会话/消息/任务/checkpoint/知识库/MCP/Skill/审计/trace |
| 四层隔离 | `app/core/deps.py` | 请求强制携带 `tenant_id + app_id`，令牌与 header 不一致即拒绝 |
| 会话隔离 | `app/services/conversations.py` | `conversation_id` 即 LangGraph `thread_id`，按 `user_id` 校验归属 |
| 智能路由 | `app/graph/routing/` | 规则 / 语义 / 混合三种策略，规则确定性兜底默认 Agent |
| 兜底终态 | `app/graph/guards.py` `runner.py` | 最大轮次熔断、死循环检测、超时、异常一律收敛为终态 |
| 任务状态机 | `app/models/conversation.py` | `created → running → waiting_human → 6 种终态`，非法迁移拒绝 |
| 对话接口 | `app/api/v1/chat.py` | 一次请求串起 会话→任务→图执行→消息→隐藏返回 |
| 模型网关 | `app/graph/spec.py` + 后续 | 逻辑模型/降级链在 M2 接入实际 LLM |

## 接口速览

```
POST   /api/v1/tenants                      创建租户
POST   /api/v1/apps                         创建应用（需 X-Tenant-Id）
POST   /api/v1/apps/{app_id}/chat            对话（跑通 LangGraph）
GET    /api/v1/conversations                 会话列表
GET    /api/v1/conversations/{id}/messages    历史消息
GET    /health                              健康检查
```

## 约定

- 依赖与运行统一用 **uv**（`uv sync` / `uv add` / `uv run`），`uv.lock` 入库。
- 所有多租户查询必须带 `tenant_id` 作用域，跨租户等同不存在（返回 404 而非 403，避免泄漏存在性）。
- 任何图执行都必须收敛到终态，禁止无限挂起。
