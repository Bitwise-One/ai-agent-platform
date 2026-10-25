# 后端（M1 + M2）

通用智能体平台后端：FastAPI + LangGraph + SQLAlchemy(async)。

## 快速开始（uv）

```bash
cd backend
uv sync                                  # 安装依赖（含 dev 组）
cp .env.example .env                     # 按需修改 DATABASE_URL / LLM_API_KEY
uv run alembic upgrade head              # 建表（推荐：走迁移，与模型始终一致）
uv run uvicorn app.main:app --reload     # 启动，文档 http://127.0.0.1:8000/docs
```

> `scripts/init_db.py`（`create_all`）仅用于本地快速验证，正式环境一律用 Alembic。

测试与检查：

```bash
uv run pytest                        # 全部后端测试
uv run ruff check app tests alembic
uv run alembic check                 # 校验「模型 vs 迁移」零差异
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
| SSE 流式 | `app/api/v1/chat.py` `app/graph/emitter.py` | `meta → route/rag/token → hidden → done`，token 经 ContextVar 实时外推 |
| 工作流 | `app/services/workflows.py` | CRUD + 可视化编排 `nodes/edges` 读写 + 版本快照/发布/回滚 |
| 迁移 | `alembic/` | 首版迁移含 24 表、PostgreSQL RLS 策略与 pgvector 能力探测 |

## M2 已实现

| 能力 | 位置 | 说明 |
|---|---|---|
| 模型网关 | `app/gateway/` | 统一抽象 + 重试 + 降级链（主模型 → 备用模型 → mock），业务层不感知厂商 |
| OpenAI 兼容 provider | `app/gateway/openai_compat.py` | 走 `/chat/completions`，同时支持流式与非流式 |
| 离线兜底 | `app/gateway/mock.py` | 未配密钥时模板回显；能识别 RAG 分隔符回显参考资料，便于离线验收 |
| 模型目录 | `app/api/v1/models.py` | 租户级模型清单 CRUD + 连通性探测（`/models/{id}/probe`） |
| Agent 配置 | `app/services/agents.py` | CRUD + 知识库绑定 + `model_config_id` 归属校验（防跨租户蹭额度） |
| 知识库 RAG | `app/knowledge/` | 切分（滑窗+重叠）→ 向量化 → 余弦检索 → 注入 system 提示（标注为不可信数据） |
| 知识库接口 | `app/api/v1/knowledge.py` | 库/文档 CRUD、检索调试（返回命中片段与耗时） |

## Skill 沙箱 ABI

本地可执行 Skill 使用 WebAssembly 模块，不接受 Python/本机可执行文件。模块不能声明任何宿主导入（包括 WASI），并需导出 `memory`、`alloc(i32) -> i32`、`run(i32, i32) -> i64`。平台把 UTF-8 JSON 参数写入 `alloc` 返回的地址；`run` 返回值高 32 位为 JSON 输出地址、低 32 位为字节长度，输出必须是 JSON 对象。

每次调用限制模块 256 KiB、输入 64 KiB、输出 64 KiB、线性内存 16 MiB、燃料 1,000,000，并发执行槽 4。仅通过 `POST /api/v1/skills/{skill_id}/invoke` 调用；上传字段为 `wasm_module_base64`，该字段不会在 Skill 查询接口中回显。

## MCP 凭据

MCP 配置只保存凭据引用，例如 `{"url":"https://mcp.example/mcp","auth":{"scheme":"bearer","secret_ref":"CRM_READONLY"}}`。实际令牌由部署环境注入为 `MCP_SECRET_CRM_READONLY`；请求时才注入 Bearer 请求头，管理接口只回显引用。轮换时更新部署 Secret 并滚动重启服务，禁止把实际令牌写入 MCP `config`、仓库或日志。

工具调用必须是 Agent 已绑定的工具：`POST /api/v1/apps/{app_id}/agents/{agent_id}/mcp-tools/{tool_id}/call`。租户可通过 `GET /api/v1/mcp-servers/calls/logs` 分页查询调用状态、耗时与错误类型；日志只存参数/结果形状和字节数，不存实际值。

隐藏动作采用短时、签名且一次性的 capability token，绑定租户、应用、会话、run、action 和 payload 摘要；通过带已认证 `app_id + user_id` 的 `POST /api/v1/hidden-actions/consume` 消费。`call_function` 与 `download_file` 在预注册操作目录就绪前不签发 token。

## 接口速览

```
POST   /api/v1/tenants                          创建租户
POST   /api/v1/apps                             创建应用（需 X-Tenant-Id）
GET    /api/v1/apps/{app_id}/agents             Agent 列表
PUT    /api/v1/apps/{app_id}/agents/{id}/knowledge-bases   绑定知识库（覆盖式）
POST   /api/v1/apps/{app_id}/workflows          创建工作流
PUT    /api/v1/apps/{app_id}/workflows/{id}/graph          保存编排图
POST   /api/v1/apps/{app_id}/workflows/{id}/release        发布版本
POST   /api/v1/apps/{app_id}/chat               对话（非流式）
POST   /api/v1/apps/{app_id}/chat/stream        对话（SSE 流式）
GET    /api/v1/models                           模型目录
POST   /api/v1/models/{id}/probe                模型连通性探测
POST   /api/v1/knowledge-bases                  创建知识库
POST   /api/v1/knowledge-bases/{id}/documents   文档入库（自动切分+向量化）
POST   /api/v1/knowledge-bases/{id}/search      检索调试
GET    /api/v1/conversations/{id}/messages       历史消息
GET    /health                                  健康检查
```

## 约定

- 依赖与运行统一用 **uv**（`uv sync` / `uv add` / `uv run`），`uv.lock` 入库。
- 所有多租户查询必须带 `tenant_id` 作用域，跨租户等同不存在（返回 404 而非 403，避免泄漏存在性）。
- 任何图执行都必须收敛到终态，禁止无限挂起。
- **`alembic.ini` 必须保持纯 ASCII**（它以系统 locale 编码解析，中文会导致 `UnicodeDecodeError`）。
- 改 ORM 必须同批提交迁移，`uv run alembic check` 需零差异（CI 已固化）。
