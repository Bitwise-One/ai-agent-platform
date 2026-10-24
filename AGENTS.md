# AGENTS.md — AI Agent Platform 开发约束与协作规范

> 本文档是所有 AI 助手（Agent）和开发者在本仓库协作时必须遵守的**唯一权威约束**。
> 任何实现、提交、文档产出都必须符合本文档的约定。若与本文档冲突，以本文档为准。

---

## 1. 项目定位

本项目是一个**通用智能体平台（General-Purpose Agent Platform）**，用于承载多个 AI 应用，为多租户提供可配置的智能体编排能力。

核心能力：
- **多租户（Multi-Tenancy）**：一个平台，多个租户，数据与配置严格隔离。
- **多应用（Applications）**：一个租户下可创建多个 AI 应用。
- **多智能体（Agents）**：一个应用下可配置多个 Agent。
- **多工作流（Workflows）**：一个应用可定义多个工作流，**一个应用绑定一个默认工作流**；工作流支持**智能路由**，在多 Agent 间动态选择执行路径。
- **扩展能力**：MCP 服务、Skills、知识库（RAG）。
- **智能编排引擎**：基于 **LangGraph** 实现有状态的图编排与智能路由。

---

## 2. 技术栈约束（不可擅自更改）

| 层 | 技术选型 | 说明 |
|---|---|---|
| 后端语言 | Python 3.11+ | 统一使用 Python |
| **包管理（后端）** | **uv** | 统一使用 `uv`；禁止用 pip/poetry 安装依赖 |
| 编排框架 | **LangGraph** | 有状态图编排、智能路由、人工介入（human-in-the-loop） |
| 后端框架 | FastAPI | REST + WebSocket/SSE 流式接口 |
| LLM 接入 | LangChain / 直接 SDK | 统一抽象层，可插拔多家模型 |
| 向量检索 | 向量数据库（如 pgvector / Milvus / Qdrant） | 知识库 RAG |
| 数据库 | PostgreSQL | 业务数据 + 配置持久化 |
| 缓存/队列 | Redis | 会话状态、异步任务 |
| 前端框架 | **React 18 + TypeScript** | 管理台 |
| 前端构建 | Vite | 开发与构建 |
| 前端动效 | Framer Motion / GSAP + CSS | 实现高级智能动效 |
| 前端样式 | Tailwind CSS + 设计系统 | 统一 UI 规范 |
| 包管理（前端） | pnpm | 统一使用 pnpm |

> 除上述选型外，如需引入新的第三方依赖，必须在 PR/提交说明中说明理由。

### 2.1 Python 依赖与运行约定（强制）

- 依赖声明写在 `backend/pyproject.toml`；运行时依赖放 `dependencies`，开发工具放 `[dependency-groups].dev`。
- 安装/同步依赖统一用 `uv sync`，新增依赖用 `uv add <pkg>` / `uv add --dev <pkg>`。
- 运行命令统一用 `uv run <cmd>`，例如：
  - 跑服务：`uv run uvicorn app.main:app --reload`
  - 跑测试：`uv run pytest`
  - 迁移：`uv run alembic upgrade head`
- `uv.lock` 必须提交到仓库，保证团队与 CI 环境一致。
- 禁止提交 `.venv/`。

### 2.2 数据库迁移约定（强制）

- **`backend/alembic.ini` 必须保持纯 ASCII**。原因：Alembic 用 `configparser`
  读取 ini，且以**系统 locale 编码**解码（zh-CN Windows 下是 GBK）。一旦写入中文，
  `alembic` 所有命令会直接抛 `UnicodeDecodeError` 而无法启动。
  中文说明请写到 `alembic/env.py`、迁移脚本或本文档里——这些是 Python/UTF-8 源文件。
- **改 ORM 必须同批带迁移**：`app/models/` 任何字段增删都必须在同一个 commit 里
  包含 `alembic revision` 产物，禁止「先合代码、迁移后续补」。
- **迁移脚本不得依赖未导入的符号**：`autogenerate` 生成的 `sa.JSON().with_variant(
  postgresql.JSONB(astext_type=Text()), ...)` 中的 `Text` 不会自动加 import，
  必须手工补 `from sqlalchemy import Text`。
- **方言差异要显式分支**：PostgreSQL 专属能力（RLS、pgvector、部分索引）必须写成
  `if bind.dialect.name != "postgresql": return` 或 `DO $$ ... $$` 能力探测，
  保证 SQLite（本地测试/CI）可跑通。
- **提交前自检**（CI 已固化，见 `backend/tests/test_migrations.py`）：

  ```bash
  uv run alembic upgrade head   # 空库可升级
  uv run alembic check          # 模型与迁移零差异，否则说明漏了迁移
  ```

### 2.3 字段中文说明（comment）约定（强制）

字段的业务含义要能被 DBA / 排障的人直接看到，所以**说明写在数据库里，而不是只写在代码注释里**。

- **唯一事实来源是 ORM**：`app/models/` 里每个列都写 `mapped_column(..., comment="中文说明")`。
  迁移里的 `COMMENT ON COLUMN` 文本由元数据生成，**不要手抄一份**——`comment` 会被
  `alembic check` 逐字比对，差一个标点就会报漂移。
- **新增/修改字段的流程**：改 ORM（含 `comment`）→ `alembic revision` 生成迁移 →
  在迁移里补对应的 `COMMENT ON COLUMN`（用 `op.execute`，见
  `alembic/versions/a6ce26b3419c_add_column_comments.py`）→ PG 上 `alembic check` 零差异。
- **SQLite 没有列注释**：`COMMENT ON COLUMN` 是 PG 语法，SQLite 既无语法也无处存。
  迁移里必须 `if op.get_bind().dialect.name != "postgresql": return` 短路，
  否则本地与 CI（都是 SQLite）直接报错。**注释的验收只能在 PostgreSQL 上做**。
- 查看方式（PG）：

  ```sql
  -- 单表
  \d+ tenant
  -- 全库
  SELECT c.relname, a.attname, col_description(a.attrelid, a.attnum)
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
  WHERE a.attnum > 0 AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NOT NULL
  ORDER BY c.relname, a.attnum;
  ```

- 说明写法要求：写「是什么 + 关键约束/枚举取值」，不要只写字段名直译（`# 状态` 属于无效说明）。

---

### 2.4 前端依赖与运行约定（强制）

- 依赖安装/构建一律用 `pnpm`：`pnpm install` / `pnpm dev` / `pnpm typecheck` / `pnpm build`。
- **`pnpm-lock.yaml` 必须提交**，与 `uv.lock` 同理；禁止提交 `node_modules/`、`dist/`。
- **pnpm 配置写在 `frontend/pnpm-workspace.yaml`**。pnpm 10+ 起 `package.json` 的 `pnpm` 字段不再生效，写在那里会被静默忽略。
- **必须保留 `nodeLinker: hoisted`**。默认的 isolated 布局依赖符号链接，在本机（Windows 普通用户）建链失败，
  `node_modules/@types/react` 之类会变成**空目录**，表现为 `tsc` 满屏 `Cannot find type definition file`。
  症状容易被误判为「依赖没装」，实际是布局问题。
- **依赖的构建脚本需显式放行**：pnpm 11 默认拦截 postinstall，`esbuild` 不放行会导致 `vite` 启动即失败。
  放行名单写在 `onlyBuiltDependencies`，新增需要编译的依赖时同步补充（这是可审计的动作，不要用 `--ignore-scripts` 绕过）。
- 开发态端口 5173，`/api` 由 Vite 代理到 `127.0.0.1:8000`，因此后端**不需要开 CORS**，前端代码里也不出现绝对地址。

---

## 3. 架构原则

1. **租户隔离是硬约束**：任何跨租户的数据访问、配置读写都必须经过租户上下文校验，禁止横向越权。
2. **四层隔离边界**：租户 → 应用 → 会话 → 消息。会话（Conversation）是运行时隔离单元，LangGraph checkpoint 必须以 `conversation_id` 为单位持久化，禁止跨会话状态串扰。
3. **一切皆可配置**：Agent、工作流、工具、知识库、模型、提示词均通过管理台配置，而非硬编码。
4. **编排与执行分离**：LangGraph 负责编排（状态图 + 路由），工具/MCP/Skill 负责执行，二者通过统一接口解耦。
5. **智能路由优先于硬编码**：工作流中的多 Agent 路径选择必须支持基于 LLM 的语义路由 + 规则路由的混合模式。
6. **可观测性**：每次执行必须可追踪（trace），记录节点、耗时、token、错误。
7. **幂等与可重试**：工作流节点需具备幂等性，支持断点续跑。
8. **安全**：密钥（API Key 等）一律走密钥管理，禁止明文入库、入代码、入日志。
9. **结束态必达**：任何执行必须以「成功 / 降级 / 转人工」之一收尾，禁止无限挂起。所有循环/递归必须有最大步数熔断、超时熔断与死循环检测。
10. **最小自治原则**：使用能解决问题的最少自治度；高风险/不可逆操作必须 human-in-the-loop。
11. **最小权限原则**：Agent/工具仅拥有完成任务所需的最小权限，所有检索到的外部内容一律视为不可信数据而非指令（防注入）。
12. **评估门禁**：任何影响 Agent 行为的改动需通过离线评估（黄金数据集）门禁，禁止仅凭"demo 跑通一次"上线。

---

## 4. Git 提交规范（强制）

采用 **Conventional Commits（约定式提交）**，格式：

```
<type>(<scope>): <subject>
```

### 4.1 type 取值

| type | 含义 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更（仅文档） |
| `style` | 代码格式（不影响逻辑） |
| `refactor` | 重构（非新功能、非修 bug） |
| `perf` | 性能优化 |
| `test` | 新增/修改测试 |
| `build` | 构建系统或外部依赖变更 |
| `ci` | CI 配置变更 |
| `chore` | 其他杂项（不修改 src/test） |

### 4.2 规则

- `subject` 使用**祈使句、现在时**，首字母小写，结尾不加句号，不超过 50 字符。
- `scope` 可选，用小写，如 `workflow`、`tenant`、`console`、`mcp`。
- 破坏性变更需在 footer 加 `BREAKING CHANGE:` 说明。
- **每个逻辑步骤单独提交**，禁止把多个不相关改动混在一个 commit。
- 提交信息必须使用 ASCII 直引号，禁止全角标点在 code/config 中。

### 4.3 示例

```
feat(workflow): 新增多 agent 智能路由节点
docs: 编写项目需求文档
fix(tenant): 修复租户越权访问漏洞
chore: 初始化项目结构与 git 提交规范
```

---

## 5. 目录结构约定

```
ai-agent-platform/
├── AGENTS.md                 # 本约束文档
├── docs/                     # 需求文档、设计文档
│   └── requirements/         # 需求文档（PRD）
├── backend/                  # Python 后端
│   ├── app/
│   │   ├── api/              # FastAPI 路由
│   │   ├── core/             # 配置、安全、依赖注入
│   │   ├── graph/            # LangGraph 编排与智能路由
│   │   ├── agents/           # Agent 定义与运行时
│   │   ├── workflows/        # 工作流定义
│   │   ├── mcp/              # MCP 服务集成
│   │   ├── skills/           # Skills 能力
│   │   ├── knowledge/        # 知识库 / RAG
│   │   ├── models/           # 数据模型（ORM）
│   │   └── schemas/          # Pydantic 模型
│   └── tests/
├── frontend/                 # React 管理台
│   ├── src/
│   │   ├── pages/            # 页面（概览 / 工作流 / Agent / 知识库 / 模型 / 调试台）
│   │   ├── components/       # 通用组件（Shell、ui 基础件、图标）
│   │   ├── lib/              # API 客户端、SSE 解析、hooks、类型
│   │   ├── state/            # 全局状态（租户/应用上下文）
│   │   └── styles.css        # 设计令牌与全局样式
│   └── ...
├── deploy/                   # 部署配置
└── .gitignore
```

---

## 6. 开发流程

1. 功能开发前先确认需求文档（`docs/requirements/`）与本文档。
2. 每个功能分支命名：`feat/<scope>-<描述>`，如 `feat/workflow-smart-routing`。
3. 提交前自查是否符合提交规范（见第 4 节）。
4. 涉及租户隔离、权限、密钥的改动，必须经过 review。
5. 动效类改动需兼顾流畅性（60fps）与可访问性（prefers-reduced-motion）。

---

## 7. 关键术语约定

| 术语 | 定义 |
|---|---|
| **租户 Tenant** | 平台的隔离单元，拥有独立的用户、应用与数据 |
| **应用 Application** | 租户下的一个 AI 应用（业务入口），绑定一个默认工作流 |
| **会话 Conversation** | 应用之下的运行时隔离单元，以 `app_id + user_id + conversation_id` 标识，是 LangGraph checkpoint 的挂载点 |
| **Agent** | 具备特定角色/工具/提示词的智能体 |
| **工作流 Workflow** | 由 LangGraph 定义的有状态编排图，含智能路由 |
| **智能路由 Smart Routing** | 运行时根据语义/规则在多 Agent 路径间动态选择 |
| **MCP** | Model Context Protocol，标准化的工具接入协议 |
| **Skill** | 可复用的能力单元（如本地 skill） |
| **知识库 Knowledge Base** | 供 RAG 检索的文档/向量集合 |
| **隐藏返回 Hidden Response** | 不展示在聊天框、供前端触发操作的结构化返回 |

---

*本文档如有变更，须同步更新并单独提交（`docs:` 或 `chore:`）。*
