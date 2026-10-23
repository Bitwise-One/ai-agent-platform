# 数据库详细设计（DDL）

> 对应 PRD §6.1 数据模型 ERD。目标数据库 PostgreSQL 15+。所有业务表带 `tenant_id` 用于行级隔离，核心表带审计字段。

---

## 1. 设计约定

- 主键统一 `UUID`（`gen_random_uuid()`），业务唯一键另建唯一索引。
- 时间字段统一 `TIMESTAMPTZ`。
- 所有多租户业务表强制带 `tenant_id`，配合 RLS（Row Level Security）实现双重隔离。
- 软删除：核心业务表用 `deleted_at`，物理数据保留。
- 审计字段：`created_at`、`updated_at`、`created_by`、`updated_by`。
- 金额/token 计数用 `BIGINT`，避免精度问题。

---

## 2. 租户与成员

```sql
-- 扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 租户
CREATE TABLE tenant (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(128) NOT NULL,
    slug        VARCHAR(64)  NOT NULL UNIQUE,
    status      VARCHAR(16)  NOT NULL DEFAULT 'active',  -- active / suspended / deleted
    quota       JSONB        NOT NULL DEFAULT '{}',       -- 配额：app数、agent数、存储、调用量
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- 租户成员
CREATE TABLE member (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id),
    user_id     VARCHAR(128) NOT NULL,           -- 对接 SSO/外部用户体系
    role        VARCHAR(32)  NOT NULL DEFAULT 'member',  -- admin / developer / member
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);
```

---

## 3. 应用与 Agent

```sql
-- 应用（业务入口）
CREATE TABLE application (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenant(id),
    name                  VARCHAR(128) NOT NULL,
    description           TEXT,
    icon                  VARCHAR(512),
    default_workflow_id   UUID,                   -- 绑定默认工作流（1:1，后设外键）
    default_model_params  JSONB NOT NULL DEFAULT '{}',  -- 温度、max_tokens 等
    status                VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ
);
CREATE INDEX idx_app_tenant ON application(tenant_id);

-- Agent
CREATE TABLE agent (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    application_id   UUID NOT NULL REFERENCES application(id),
    name             VARCHAR(128) NOT NULL,
    system_prompt    TEXT NOT NULL,
    model_config_id  UUID,                        -- 引用 model_config（模型网关）
    temperature      FLOAT NOT NULL DEFAULT 0.7,
    max_context_len  INT   NOT NULL DEFAULT 8000,
    memory_strategy  VARCHAR(32) NOT NULL DEFAULT 'sliding_window', -- sliding_window / summary / hybrid
    status           VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_agent_app ON agent(application_id);
```

---

## 4. 工作流与版本

```sql
-- 工作流（编排图模板）
CREATE TABLE workflow (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    application_id   UUID NOT NULL REFERENCES application(id),
    name             VARCHAR(128) NOT NULL,
    description      TEXT,
    graph_definition JSONB NOT NULL,             -- LangGraph 图结构（节点/边/路由策略）
    current_version_id UUID,                     -- 当前生效版本
    status           VARCHAR(16) NOT NULL DEFAULT 'draft',  -- draft / published / archived
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_app ON workflow(application_id);

-- 工作流版本（不可变快照，支持回滚/灰度）
CREATE TABLE workflow_version (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id   UUID NOT NULL REFERENCES workflow(id),
    version       INT  NOT NULL,
    snapshot      JSONB NOT NULL,                -- 该版本的完整图定义快照
    changelog     TEXT,
    status        VARCHAR(16) NOT NULL DEFAULT 'draft', -- draft / released / rolled_back
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_id, version)
);

-- 应用默认工作流外键（延迟添加，避免循环依赖）
ALTER TABLE application
    ADD CONSTRAINT fk_app_default_workflow
    FOREIGN KEY (default_workflow_id) REFERENCES workflow(id);
```

---

## 5. 会话、消息、任务与 checkpoint

```sql
-- 会话（运行时隔离单元）
CREATE TABLE conversation (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    application_id   UUID NOT NULL REFERENCES application(id),
    user_id          VARCHAR(128) NOT NULL,      -- 终端用户
    title            VARCHAR(256),
    status           VARCHAR(16) NOT NULL DEFAULT 'active', -- active / archived / closed
    metadata         JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at      TIMESTAMPTZ
);
CREATE INDEX idx_conv_app_user ON conversation(application_id, user_id);

-- 消息
CREATE TABLE message (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id),
    conversation_id   UUID NOT NULL REFERENCES conversation(id),
    role              VARCHAR(16) NOT NULL,      -- user / assistant / system / tool
    content           TEXT,
    tool_calls        JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_conv ON message(conversation_id, created_at);

-- 隐藏返回（挂消息之下，不展示在聊天框）
CREATE TABLE hidden_response (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id),
    message_id  UUID REFERENCES message(id),
    run_id      UUID NOT NULL,
    action      VARCHAR(64) NOT NULL,            -- open_form / navigate / ...
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 任务运行（一次执行，遵循状态机）
CREATE TABLE task_run (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenant(id),
    conversation_id       UUID NOT NULL REFERENCES conversation(id),
    workflow_version_id   UUID REFERENCES workflow_version(id),
    status                VARCHAR(24) NOT NULL DEFAULT 'created',
                          -- created/running/waiting_human/completed/degraded/failed/timed_out/cancelled/escalated
    input                 JSONB,
    output                JSONB,
    error                 JSONB,
    token_usage           BIGINT NOT NULL DEFAULT 0,
    cost                  NUMERIC(12,6) NOT NULL DEFAULT 0,
    started_at            TIMESTAMPTZ,
    finished_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_run_conv ON task_run(conversation_id, created_at);
CREATE INDEX idx_run_status ON task_run(status);

-- LangGraph checkpoint（thread_id = conversation_id）
CREATE TABLE checkpoint (
    thread_id      UUID NOT NULL,
    checkpoint_ns  VARCHAR(128) NOT NULL DEFAULT '',
    checkpoint_id  UUID NOT NULL,
    parent_checkpoint_id UUID,
    type           VARCHAR(16),                  -- channel / task
    checkpoint     JSONB NOT NULL,               -- 状态快照
    metadata       JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
```

---

## 6. 知识库与文档

```sql
-- 知识库
CREATE TABLE knowledge_base (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id),
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    embedding_model VARCHAR(128),                -- 向量模型
    vector_dim  INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- 文档
CREATE TABLE document (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id),
    kb_id         UUID NOT NULL REFERENCES knowledge_base(id),
    title         VARCHAR(256) NOT NULL,
    source        VARCHAR(512),                  -- 原始来源
    file_type     VARCHAR(32),
    status        VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending/parsing/indexed/failed
    access_scope  JSONB NOT NULL DEFAULT '{}',   -- 文档级权限范围
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

-- 分块（向量引用，向量存向量库，这里存元信息）
CREATE TABLE chunk (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id),
    document_id UUID NOT NULL REFERENCES document(id),
    seq         INT NOT NULL,
    content     TEXT NOT NULL,
    vector_id   VARCHAR(128),                    -- 向量库中的 ID
    token_count INT,
    UNIQUE (document_id, seq)
);
```

---

## 7. MCP / Skill / 模型 / 密钥

```sql
-- MCP 服务
CREATE TABLE mcp_server (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id),
    name        VARCHAR(128) NOT NULL,
    transport   VARCHAR(16) NOT NULL,            -- stdio / sse / http
    config      JSONB NOT NULL DEFAULT '{}',     -- 连接配置（脱敏后存储）
    status      VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skill
CREATE TABLE skill (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id),
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    params_schema JSONB,                         -- 参数 schema
    trigger     JSONB,                           -- 触发条件
    source      VARCHAR(32) NOT NULL DEFAULT 'local', -- local / marketplace
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 模型配置（模型网关）
CREATE TABLE model_config (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id),
    name          VARCHAR(128) NOT NULL,         -- 逻辑模型名
    provider      VARCHAR(32) NOT NULL,          -- openai / anthropic / qwen / ...
    model_name    VARCHAR(128) NOT NULL,         -- 供应商模型名
    context_len   INT,
    price_in      NUMERIC(12,6),                 -- 每 1K input token 价格
    price_out     NUMERIC(12,6),
    capabilities  JSONB NOT NULL DEFAULT '{}',   -- 能力标签
    status        VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- API 密钥（加密存储，此处只存密文引用）
CREATE TABLE api_key (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id),
    application_id UUID REFERENCES application(id),
    key_hash     VARCHAR(256) NOT NULL,          -- 只存哈希，不存明文
    prefix       VARCHAR(16) NOT NULL,           -- 展示用前缀
    scope        VARCHAR(16) NOT NULL DEFAULT 'rw', -- ro / rw / admin
    expires_at   TIMESTAMPTZ,
    status       VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_api_key_hash ON api_key(key_hash);
```

---

## 8. 多对多关联表

```sql
-- Agent ↔ 知识库
CREATE TABLE agent_kb (
    agent_id UUID NOT NULL REFERENCES agent(id),
    kb_id    UUID NOT NULL REFERENCES knowledge_base(id),
    PRIMARY KEY (agent_id, kb_id)
);

-- Agent ↔ MCP
CREATE TABLE agent_mcp (
    agent_id    UUID NOT NULL REFERENCES agent(id),
    mcp_id      UUID NOT NULL REFERENCES mcp_server(id),
    PRIMARY KEY (agent_id, mcp_id)
);

-- Agent ↔ Skill
CREATE TABLE agent_skill (
    agent_id  UUID NOT NULL REFERENCES agent(id),
    skill_id  UUID NOT NULL REFERENCES skill(id),
    PRIMARY KEY (agent_id, skill_id)
);

-- 工作流 ↔ Agent（编排关系）
CREATE TABLE workflow_agent (
    workflow_id UUID NOT NULL REFERENCES workflow(id),
    agent_id    UUID NOT NULL REFERENCES agent(id),
    PRIMARY KEY (workflow_id, agent_id)
);
```

---

## 9. 审计与 trace

```sql
-- 审计日志（append-only，独立库或独立 schema）
CREATE TABLE audit_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID,
    application_id UUID,
    conversation_id UUID,
    actor         VARCHAR(128),                  -- 操作者
    action        VARCHAR(64) NOT NULL,          -- 动作
    object_type   VARCHAR(64),                   -- 对象类型
    object_id     VARCHAR(128),
    result        VARCHAR(16),                   -- success / denied / failed
    detail        JSONB,
    source_ip     VARCHAR(64),
    request_id    VARCHAR(128),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant_time ON audit_log(tenant_id, created_at);

-- trace 事件（可观测性）
CREATE TABLE trace_event (
    event_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      UUID NOT NULL,
    node        VARCHAR(128) NOT NULL,           -- 节点名
    kind        VARCHAR(16) NOT NULL,            -- llm / tool / node / route
    latency_ms  INT,
    tokens_in   INT,
    tokens_out  INT,
    status      VARCHAR(16),                     -- success / error / retry
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trace_run ON trace_event(run_id, created_at);
```

---

## 10. 行级安全（RLS）示意

```sql
-- 启用 RLS（以 application 为例，其余多租户表同理）
ALTER TABLE application ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON application
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

> 应用层通过 `SET app.current_tenant_id = '...'` 在事务/请求上下文中注入租户上下文，RLS 作为数据库级兜底，与中间件校验形成双重隔离。

---

## 11. 迁移管理

- 使用 **Alembic** 管理数据库迁移，所有 DDL 变更走 migration 脚本，禁止手工改库。
- 命名：`<序号>_<描述>.py`，如 `0001_create_tenant_and_member.py`。
- 破坏性变更需先做兼容迁移（加列→双写→回填→切读→删列），禁止一步到位 drop。
