"""initial schema — 平台首版数据库结构

本迁移由 Alembic autogenerate 基于 ORM 元数据生成，并做了两处人工增强：

1. **按业务域分组并补注释**：24 张表并非平铺罗列，而是按「平台级 → 应用级 →
   编排级 → 对话级 → 检索级 → 观测级」六层组织。分组顺序同时满足外键依赖
   （被引用表必须先建），因此不能随意调换 `create_table` 的先后。
2. **追加 PostgreSQL 行级安全（RLS）**：多租户隔离在应用层由 `tenant_id` 过滤
   保证，但应用层过滤依赖「每个查询都记得加条件」这一人为纪律。RLS 把这条纪律
   下沉到数据库，即使某条 SQL 漏写 `WHERE tenant_id = ?`，数据库也会返回空集，
   从而形成最后一道防线。SQLite（本地测试）不支持 RLS，故按方言条件跳过。

租户作用域约定：
- 「平台级」表不带 `tenant_id`（如 `tenant` 自身、`checkpoint` 中间态）；
- 其余业务表一律带 `tenant_id`，并纳入 RLS 保护；
- `audit_log.tenant_id` 允许为空（记录登录失败等尚未确定租户的事件），
  因此其 RLS 策略额外放行 `NULL` 行，避免把平台级审计记录一起屏蔽。

本文件字段含义以行内注释为准。

Revision ID: fdbe27c865ca
Revises:
Create Date: 2026-10-24 08:00:26.361498
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'fdbe27c865ca'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # =====================================================================
    # 一、平台级表：不隶属于任何业务租户，或作为跨租户的底层支撑
    # =====================================================================

    # 审计日志：记录「谁在哪个层级做了什么、结果如何」，append-only。
    # tenant_id / application_id / conversation_id 三级都可空，因为登录失败、
    # 平台运维等事件可能尚无明确归属；detail 存结构化上下文（前后值差异等）。
    op.create_table('audit_log',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID 全局唯一标识
    sa.Column('tenant_id', sa.Uuid(), nullable=True),  # 所属租户；可空（未确定租户的事件），RLS 额外放行 NULL
    sa.Column('application_id', sa.Uuid(), nullable=True),  # 关联应用，可空
    sa.Column('conversation_id', sa.Uuid(), nullable=True),  # 关联会话，可空
    sa.Column('actor', sa.String(length=128), nullable=True),  # 操作者标识（用户/服务账号），可空
    sa.Column('action', sa.String(length=64), nullable=False),  # 动作类型（如 login/create/update/delete）
    sa.Column('object_type', sa.String(length=64), nullable=True),  # 被操作对象类型（如 application/agent/document），可空
    sa.Column('object_id', sa.String(length=128), nullable=True),  # 被操作对象 ID，可空
    sa.Column('result', sa.String(length=16), nullable=True),  # 操作结果：success/denied/failed，可空
    sa.Column('detail', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 结构化上下文（前后值差异、错误摘要等）
    sa.Column('source_ip', sa.String(length=64), nullable=True),  # 来源 IP，可空
    sa.Column('request_id', sa.String(length=128), nullable=True),  # 请求追踪 ID，便于串联链路，可空
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间，默认当前时间
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_log_tenant_id'), 'audit_log', ['tenant_id'], unique=False)

    # LangGraph 检查点：保存图执行的中间状态，支撑断点续跑与人工介入。
    # 联合主键 (thread_id, checkpoint_ns, checkpoint_id) 与 LangGraph 官方
    # 序列化格式对齐；thread_id 直接取 conversation_id，保证「一条会话一条线程」。
    op.create_table('checkpoint',
    sa.Column('thread_id', sa.Uuid(), nullable=False),  # 线程 ID，直接取 conversation_id（一条会话一条线程），联合主键之一
    sa.Column('checkpoint_ns', sa.String(length=128), nullable=False),  # 检查点命名空间，联合主键之一，默认空串
    sa.Column('checkpoint_id', sa.Uuid(), nullable=False),  # 检查点 ID，联合主键之一
    sa.Column('parent_checkpoint_id', sa.Uuid(), nullable=True),  # 父检查点 ID，用于回溯执行路径，可空
    sa.Column('type', sa.String(length=16), nullable=True),  # 类型：channel（通道状态）/task（任务），可空
    sa.Column('checkpoint', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 图执行的完整状态快照
    sa.Column('metadata', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # LangGraph 写入的元数据（来源、步数等）
    sa.PrimaryKeyConstraint('thread_id', 'checkpoint_ns', 'checkpoint_id')
    )
    # 租户：隔离体系的第一层。slug 全局唯一，作为对外可读标识（URL / 子域名）。
    # quota 存配额策略（并发数、月 token 上限等）；deleted_at 实现软删除，
    # 避免误删租户导致历史数据出现悬空外键。
    op.create_table('tenant',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('name', sa.String(length=128), nullable=False),  # 租户名称
    sa.Column('slug', sa.String(length=64), nullable=False),  # 全局唯一可读标识（URL/子域名）
    sa.Column('status', sa.String(length=16), nullable=False),  # 租户状态：active/suspended/deleted
    sa.Column('quota', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 配额策略：应用数、agent 数、存储、调用量上限等
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 更新时间
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),  # 软删除时间，非空表示已删除
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    # 追踪事件：图执行的可观测性明细（每个节点的耗时、token、状态）。
    # 与 task_run 是「一次执行 → 多条事件」的一对多关系，用于定位慢节点与失败环节。
    op.create_table('trace_event',
    sa.Column('event_id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('run_id', sa.Uuid(), nullable=False),  # 所属任务运行 ID（一次执行产生多条事件）
    sa.Column('node', sa.String(length=128), nullable=False),  # 图节点名称/标识
    sa.Column('kind', sa.String(length=16), nullable=False),  # 事件种类：llm/tool/node/route
    sa.Column('latency_ms', sa.Integer(), nullable=True),  # 该节点耗时（毫秒）
    sa.Column('tokens_in', sa.Integer(), nullable=True),  # 输入 token 数
    sa.Column('tokens_out', sa.Integer(), nullable=True),  # 输出 token 数
    sa.Column('status', sa.String(length=16), nullable=True),  # 节点状态：success/error/retry
    sa.Column('detail', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 结构化明细（模型名、错误、重试原因等）
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.PrimaryKeyConstraint('event_id')
    )
    op.create_index(op.f('ix_trace_event_run_id'), 'trace_event', ['run_id'], unique=False)

    # =====================================================================
    # 二、应用级表：隔离体系的第二层，一个租户可挂多个对外应用
    # =====================================================================

    # 应用：对话入口的载体（一个客服机器人 / 一个内部助手就是一个应用）。
    # default_workflow_id 故意不加外键约束——它与 workflow 互相引用，
    # 建表阶段加约束会形成循环依赖；改由应用层保证一致性。
    op.create_table('application',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖此列）
    sa.Column('name', sa.String(length=128), nullable=False),  # 应用名称
    sa.Column('description', sa.Text(), nullable=True),  # 应用描述
    sa.Column('icon', sa.String(length=512), nullable=True),  # 图标 URL
    sa.Column('default_workflow_id', sa.Uuid(), nullable=True),  # 默认工作流（逻辑外键，无物理 FK 避免循环依赖）
    sa.Column('default_model_params', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 默认模型参数（temperature、max_tokens 等）
    sa.Column('status', sa.String(length=16), nullable=False),  # 应用状态：active/suspended/deleted
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 更新时间
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),  # 软删除时间，非空表示已删除
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_application_default_workflow_id'), 'application', ['default_workflow_id'], unique=False)
    op.create_index(op.f('ix_application_tenant_id'), 'application', ['tenant_id'], unique=False)

    # 知识库：检索的顶层容器。vector_dim 记录向量维度，换 embedding 模型时
    # 维度必须一致，否则旧向量无法与新查询向量做相似度计算。
    op.create_table('knowledge_base',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('name', sa.String(length=128), nullable=False),  # 知识库名称
    sa.Column('description', sa.Text(), nullable=True),  # 知识库描述
    sa.Column('embedding_model', sa.String(length=128), nullable=True),  # 使用的向量模型名，切换模型需重建索引
    sa.Column('vector_dim', sa.Integer(), nullable=True),  # 向量维度，维度不一致会导致相似度计算失效
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 更新时间
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),  # 软删除时间，非空表示已删除
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    # MCP 服务：外部工具接入点。transport 区分 stdio / sse / http，
    # config 存连接参数（命令、URL、鉴权头等，敏感值由应用层加密后再落库）。
    op.create_table('mcp_server',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('name', sa.String(length=128), nullable=False),  # 服务名称
    sa.Column('transport', sa.String(length=16), nullable=False),  # 传输方式：stdio/sse/http
    sa.Column('config', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 连接配置（命令/URL/鉴权头，敏感值脱敏后存储）
    sa.Column('status', sa.String(length=16), nullable=False),  # 服务状态：active/suspended/deleted
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 更新时间
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    # 成员：租户内用户与角色绑定。唯一约束 (tenant_id, user_id) 保证
    # 同一用户在同一租户内只有一条角色记录，避免权限判定出现歧义。
    op.create_table('member',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('user_id', sa.String(length=128), nullable=False),  # 用户标识（对接 SSO/外部用户体系）
    sa.Column('role', sa.String(length=32), nullable=False),  # 角色：admin/developer/member
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tenant_id', 'user_id', name='uq_member_tenant_user')
    )
    # 模型配置：把「厂商 + 模型名 + 价格 + 能力位」抽象成一条可复用记录。
    # agent 通过 model_config_id 引用它，因此换模型不必改 prompt；
    # price_in / price_out 用于按次计费的成本归集（6 位小数，支持极低单价）。
    op.create_table('model_config',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('name', sa.String(length=128), nullable=False),  # 逻辑模型名（业务侧引用）
    sa.Column('provider', sa.String(length=32), nullable=False),  # 厂商：openai/anthropic/qwen 等
    sa.Column('model_name', sa.String(length=128), nullable=False),  # 厂商模型名（实际调用用）
    sa.Column('context_len', sa.Integer(), nullable=True),  # 上下文窗口长度（token）
    sa.Column('price_in', sa.Numeric(precision=12, scale=6), nullable=True),  # 每 1K 输入 token 单价（元）
    sa.Column('price_out', sa.Numeric(precision=12, scale=6), nullable=True),  # 每 1K 输出 token 单价（元）
    sa.Column('capabilities', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 能力标签（如 vision、function_call、streaming）
    sa.Column('status', sa.String(length=16), nullable=False),  # 状态：active/suspended
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    # Skill：可复用的能力包（含入参 schema 与触发条件）。
    # source 区分内置 / 租户自建，便于平台升级时只覆盖内置项。
    op.create_table('skill',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('name', sa.String(length=128), nullable=False),  # 技能名称
    sa.Column('description', sa.Text(), nullable=True),  # 技能描述
    sa.Column('params_schema', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 入参 JSON Schema（校验与渲染表单用）
    sa.Column('trigger', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 触发条件（关键词/规则）
    sa.Column('source', sa.String(length=32), nullable=False),  # 来源：local（自建）/marketplace（内置）
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 更新时间
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    # Agent：真正的执行单元，属于「应用」之下。
    # keywords 供规则路由器做关键词打分；is_default 标记兜底 Agent——
    # 路由无命中时回落到它，属正常路径而非降级。
    op.create_table('agent',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('application_id', sa.Uuid(), nullable=False),  # 所属应用
    sa.Column('name', sa.String(length=128), nullable=False),  # Agent 名称
    sa.Column('system_prompt', sa.Text(), nullable=False),  # 系统提示词（行为约束/角色设定）
    sa.Column('model_config_id', sa.Uuid(), nullable=True),  # 引用的模型配置（可继承应用级默认值）
    sa.Column('temperature', sa.Float(), nullable=False),  # 采样温度（默认 0.7），越高越发散
    sa.Column('max_context_len', sa.Integer(), nullable=False),  # 最大上下文长度（token，默认 8000）
    sa.Column('memory_strategy', sa.String(length=32), nullable=False),  # 记忆策略：sliding_window/summary/hybrid
    sa.Column('keywords', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 路由关键词（含 re: 前缀表示正则）
    sa.Column('is_default', sa.Boolean(), nullable=False),  # 是否兜底 Agent（路由无命中时回落）
    sa.Column('status', sa.String(length=16), nullable=False),  # 状态：active/suspended/deleted
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 更新时间
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),  # 软删除时间，非空表示已删除
    sa.ForeignKeyConstraint(['application_id'], ['application.id'], ),
    sa.ForeignKeyConstraint(['model_config_id'], ['model_config.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_agent_application_id'), 'agent', ['application_id'], unique=False)

    # API Key：对外调用凭据。只存 key_hash 与可读前缀（prefix 用于控制台展示
    # 前 8 位做识别），明文永不落库；scope 区分读写权限。
    op.create_table('api_key',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('application_id', sa.Uuid(), nullable=True),  # 关联应用（可为平台级，故可空）
    sa.Column('key_hash', sa.String(length=256), nullable=False),  # 密钥哈希（明文永不落库）
    sa.Column('prefix', sa.String(length=16), nullable=False),  # 可读前缀，控制台展示前若干位便于识别
    sa.Column('scope', sa.String(length=16), nullable=False),  # 权限范围：ro/rw/admin
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),  # 过期时间，可空表示永不过期
    sa.Column('status', sa.String(length=16), nullable=False),  # 状态：active/revoked/expired
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),  # 最近使用时间，用于清理闲置密钥
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.ForeignKeyConstraint(['application_id'], ['application.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('key_hash')
    )
    # =====================================================================
    # 三、对话级表：隔离体系的第三、四层（conversation → message）
    # =====================================================================

    # 会话：隔离体系的第三层。user_id 是业务侧用户标识（可为外部 ID），
    # metadata 存放渠道、设备等扩展信息，避免为每个渠道加列。
    op.create_table('conversation',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID；同时作为 LangGraph thread_id
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('application_id', sa.Uuid(), nullable=False),  # 所属应用
    sa.Column('user_id', sa.String(length=128), nullable=False),  # 终端用户标识（可对接外部系统）
    sa.Column('title', sa.String(length=256), nullable=True),  # 会话标题（首条消息摘要等）
    sa.Column('status', sa.String(length=16), nullable=False),  # 状态：active/archived/closed
    sa.Column('metadata', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 扩展信息（渠道、设备、来源等）
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),  # 归档时间，非空表示已归档
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 更新时间
    sa.ForeignKeyConstraint(['application_id'], ['application.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_conversation_application_id'), 'conversation', ['application_id'], unique=False)
    # 文档：知识库下的原始资料。status 跟踪「待解析 / 已切分 / 已向量化 / 失败」，
    # access_scope 预留细粒度权限（按部门 / 角色过滤检索结果）。
    op.create_table('document',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('kb_id', sa.Uuid(), nullable=False),  # 所属知识库
    sa.Column('title', sa.String(length=256), nullable=False),  # 文档标题
    sa.Column('source', sa.String(length=512), nullable=True),  # 原始来源（URL/上传路径）
    sa.Column('file_type', sa.String(length=32), nullable=True),  # 文件类型（pdf/md/docx 等）
    sa.Column('status', sa.String(length=16), nullable=False),  # 状态：pending/parsing/indexed/failed
    sa.Column('access_scope', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 文档级访问范围（空表示租户内可见）
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),  # 软删除时间，非空表示已删除
    sa.ForeignKeyConstraint(['kb_id'], ['knowledge_base.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_document_kb_id'), 'document', ['kb_id'], unique=False)
    # =====================================================================
    # 四、编排级表：工作流（图定义）+ 版本快照，支撑灰度与回滚
    # =====================================================================

    # 工作流：graph_definition 存可视化编排的 nodes / edges（JSON），
    # 控制台拖拽即改此列；current_version_id 指向当前生效的版本快照。
    op.create_table('workflow',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('application_id', sa.Uuid(), nullable=False),  # 所属应用
    sa.Column('name', sa.String(length=128), nullable=False),  # 工作流名称
    sa.Column('description', sa.Text(), nullable=True),  # 工作流描述
    sa.Column('graph_definition', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # LangGraph 图结构（nodes/edges/路由策略）
    sa.Column('current_version_id', sa.Uuid(), nullable=True),  # 当前生效的版本快照 ID
    sa.Column('status', sa.String(length=16), nullable=False),  # 状态：draft/published/archived
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 更新时间
    sa.ForeignKeyConstraint(['application_id'], ['application.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_workflow_application_id'), 'workflow', ['application_id'], unique=False)
    # 以下三张为多对多关联表：Agent 可挂载多个知识库 / MCP / Skill。
    # 使用联合主键天然去重，避免同一资源被重复挂载导致重复检索。
    op.create_table('agent_kb',
    sa.Column('agent_id', sa.Uuid(), nullable=False),  # 关联 Agent（联合主键）
    sa.Column('kb_id', sa.Uuid(), nullable=False),  # 关联知识库（联合主键）
    sa.ForeignKeyConstraint(['agent_id'], ['agent.id'], ),
    sa.ForeignKeyConstraint(['kb_id'], ['knowledge_base.id'], ),
    sa.PrimaryKeyConstraint('agent_id', 'kb_id')
    )
    op.create_table('agent_mcp',
    sa.Column('agent_id', sa.Uuid(), nullable=False),  # 关联 Agent（联合主键）
    sa.Column('mcp_id', sa.Uuid(), nullable=False),  # 关联 MCP 服务（联合主键）
    sa.ForeignKeyConstraint(['agent_id'], ['agent.id'], ),
    sa.ForeignKeyConstraint(['mcp_id'], ['mcp_server.id'], ),
    sa.PrimaryKeyConstraint('agent_id', 'mcp_id')
    )
    op.create_table('agent_skill',
    sa.Column('agent_id', sa.Uuid(), nullable=False),  # 关联 Agent（联合主键）
    sa.Column('skill_id', sa.Uuid(), nullable=False),  # 关联技能（联合主键）
    sa.ForeignKeyConstraint(['agent_id'], ['agent.id'], ),
    sa.ForeignKeyConstraint(['skill_id'], ['skill.id'], ),
    sa.PrimaryKeyConstraint('agent_id', 'skill_id')
    )
    # =====================================================================
    # 五、检索级表：文档切分后的分块与向量
    # =====================================================================

    # 分块：RAG 的检索单元。(document_id, seq) 唯一，保证切分顺序可重放；
    # embedding 以 JSON 落库（兼容 SQLite / 未装 pgvector 的环境），
    # 生产建议迁移到 pgvector 的 vector 列并建 HNSW 索引，见文末说明。
    op.create_table('chunk',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('document_id', sa.Uuid(), nullable=False),  # 所属文档
    sa.Column('seq', sa.Integer(), nullable=False),  # 块序号（同文档内递增，保证切分顺序可重放）
    sa.Column('content', sa.Text(), nullable=False),  # 分块纯文本内容
    sa.Column('embedding', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 向量（float 列表），无向量库时用于应用层余弦检索
    sa.Column('vector_id', sa.String(length=128), nullable=True),  # 外部向量库中的 ID（若向量另存）
    sa.Column('token_count', sa.Integer(), nullable=True),  # 块的 token 数（用于预算/截断）
    sa.ForeignKeyConstraint(['document_id'], ['document.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('document_id', 'seq', name='uq_chunk_doc_seq')
    )
    op.create_index(op.f('ix_chunk_document_id'), 'chunk', ['document_id'], unique=False)
    # 消息：隔离体系的第四层，对话的原子记录。
    # role 取 user / assistant / system / tool；tool_calls 保存模型发起的
    # 工具调用（含参数与结果），使回放一段对话时不必重新调用外部工具。
    op.create_table('message',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('conversation_id', sa.Uuid(), nullable=False),  # 所属会话
    sa.Column('role', sa.String(length=16), nullable=False),  # 角色：user/assistant/system/tool
    sa.Column('content', sa.Text(), nullable=True),  # 消息文本（tool 角色可能仅含 tool_calls）
    sa.Column('tool_calls', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 模型发起的工具调用（参数与结果），回放免重调
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.ForeignKeyConstraint(['conversation_id'], ['conversation.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_message_conversation_id'), 'message', ['conversation_id'], unique=False)
    # 工作流与 Agent 的关联：声明「该工作流可以使用哪些 Agent」，
    # 真正的执行顺序由 workflow.graph_definition 的边决定。
    op.create_table('workflow_agent',
    sa.Column('workflow_id', sa.Uuid(), nullable=False),  # 关联工作流（联合主键）
    sa.Column('agent_id', sa.Uuid(), nullable=False),  # 关联 Agent（联合主键）
    sa.ForeignKeyConstraint(['agent_id'], ['agent.id'], ),
    sa.ForeignKeyConstraint(['workflow_id'], ['workflow.id'], ),
    sa.PrimaryKeyConstraint('workflow_id', 'agent_id')
    )
    # 工作流版本快照：不可变，用于灰度发布与秒级回滚。
    # snapshot 是当时 graph_definition 的完整副本，因此回滚只需切换指针，
    # 无需「反向迁移」图结构。唯一约束 (workflow_id, version) 保证版本号单调。
    op.create_table('workflow_version',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('workflow_id', sa.Uuid(), nullable=False),  # 所属工作流
    sa.Column('version', sa.Integer(), nullable=False),  # 版本号（同工作流内单调递增）
    sa.Column('snapshot', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 该版本完整图定义快照
    sa.Column('changelog', sa.Text(), nullable=True),  # 变更说明
    sa.Column('status', sa.String(length=16), nullable=False),  # 状态：draft/released/rolled_back
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.ForeignKeyConstraint(['workflow_id'], ['workflow.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('workflow_id', 'version', name='uq_workflow_version')
    )
    # =====================================================================
    # 六、运行与观测表：任务状态机、隐藏返回、审计关联
    # =====================================================================

    # 隐藏返回：模型在生成正文之外附带的结构化动作（如「更新购物车」
    # 「触发工单」）。它与可见回复分离存储，前端可只渲染 reply、
    # 由宿主页面消费 payload，从而避免把机器指令混进用户可见文本。
    op.create_table('hidden_response',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('message_id', sa.Uuid(), nullable=True),  # 关联消息（可空）
    sa.Column('run_id', sa.Uuid(), nullable=False),  # 所属任务运行 ID
    sa.Column('action', sa.String(length=64), nullable=False),  # 动作类型（open_form/navigate/trigger_ticket 等）
    sa.Column('payload', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=False),  # 结构化动作参数
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.ForeignKeyConstraint(['message_id'], ['message.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_hidden_response_run_id'), 'hidden_response', ['run_id'], unique=False)
    # 任务：一次完整执行的状态机记录。
    # status 取值共 9 个：created / running / waiting_human 三个进行态，
    # 以及 completed / degraded / failed / timed_out / cancelled / escalated
    # 六个终态。任何执行都必须收敛到六个终态之一，不允许长期悬挂。
    # token_usage / cost 汇总本次执行的全部消耗，供配额与计费使用。
    op.create_table('task_run',
    sa.Column('id', sa.Uuid(), nullable=False),  # 主键，UUID
    sa.Column('tenant_id', sa.Uuid(), nullable=False),  # 所属租户（RLS 依赖）
    sa.Column('conversation_id', sa.Uuid(), nullable=False),  # 所属会话
    sa.Column('workflow_version_id', sa.Uuid(), nullable=True),  # 关联工作流版本快照（执行时锁定版本）
    sa.Column('status', sa.String(length=24), nullable=False),  # 状态机：created/running/waiting_human/completed/degraded/failed/timed_out/cancelled/escalated
    sa.Column('input', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 本次执行的输入（query、上下文引用等）
    sa.Column('output', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 执行最终输出（含回复、动作）
    sa.Column('error', sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), 'postgresql'), nullable=True),  # 错误信息（异常类型/堆栈摘要）
    sa.Column('token_usage', sa.BigInteger(), nullable=False),  # 累计 token 消耗
    sa.Column('cost', sa.Numeric(precision=12, scale=6), nullable=False),  # 本次执行成本（元，12,6 精度）
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),  # 开始时间
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),  # 结束时间
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),  # 创建时间
    sa.ForeignKeyConstraint(['conversation_id'], ['conversation.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.ForeignKeyConstraint(['workflow_version_id'], ['workflow_version.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_task_run_conversation_id'), 'task_run', ['conversation_id'], unique=False)
    op.create_index(op.f('ix_task_run_created_at'), 'task_run', ['created_at'], unique=False)
    op.create_index(op.f('ix_task_run_status'), 'task_run', ['status'], unique=False)

    # 建表完成后追加 PostgreSQL 专属增强（RLS + 向量索引）。
    _apply_postgres_hardening()


# 纳入行级安全（RLS）保护的租户作用域表清单。
# 新增带 tenant_id 的业务表时，务必同步加到这里，否则该表会缺少数据库层兜底。
_TENANT_SCOPED_TABLES = (
    "application",
    "agent",
    "api_key",
    "conversation",
    "message",
    "workflow",
    "knowledge_base",
    "document",
    "chunk",
    "model_config",
    "skill",
    "mcp_server",
    "member",
    "hidden_response",
    "task_run",
)


def _apply_postgres_hardening() -> None:
    """追加仅在 PostgreSQL 上生效的多租户兜底与向量索引。

    设计意图：
    - **为什么用 current_setting 而不是每张表写死策略**：租户 ID 由连接级
      会话变量 `app.tenant_id` 传入（应用在获取连接时 SET LOCAL），
      策略统一读取该变量，避免为 15 张表各写一套 if/else 条件。
    - **为什么用 FORCE**：PostgreSQL 默认让表 owner 绕过 RLS，而迁移通常由
      owner 执行。加 FORCE 后连 owner 也受约束，防止误用高权限连接绕过隔离。
    - **为什么放行 NULL**：`audit_log` 等表的租户列可为空（记录未确定租户的
      事件），若不放行会导致平台级审计记录对所有人不可见。
    - **SQLite 跳过**：本地测试用 SQLite，不支持 RLS，直接返回。
    """
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # 仅在 PostgreSQL 上启用 RLS 与向量索引；SQLite（本地/CI 测试库）
        # 不支持这些特性，按方言跳过，保证迁移跨方言一致可执行。
        return

    # ---- 1) 逐表开启行级安全并创建统一策略 ----
    for table in _TENANT_SCOPED_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        # USING 控制「能读到哪些行」，WITH CHECK 控制「能写入哪些行」。
        # 两者同时声明，才能同时挡住越权读与越权写。
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
            """
        )

    # ---- 2) 审计日志单独策略：额外放行 tenant_id 为 NULL 的平台级事件 ----
    op.execute("ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE audit_log FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON audit_log
        USING (
            tenant_id IS NULL
            OR tenant_id = current_setting('app.tenant_id', true)::uuid
        )
        WITH CHECK (
            tenant_id IS NULL
            OR tenant_id = current_setting('app.tenant_id', true)::uuid
        )
        """
    )

    # ---- 3) 向量检索索引（需先启用 pgvector 扩展）----
    # chunk.embedding 当前是 JSONB（兼容无 pgvector 的部署）。若实例已安装
    # pgvector，可执行下方语句把列转成 vector 并建 HNSW 索引，检索性能从
    # 「全表扫描 + Python 计算」提升到「近似最近邻索引查询」。
    # 因为 pgvector 不是强依赖，这里用 DO 块做能力探测，缺失时安静跳过。
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
                CREATE EXTENSION IF NOT EXISTS vector;
                ALTER TABLE chunk
                    ADD COLUMN IF NOT EXISTS embedding_vec vector(1536);
                CREATE INDEX IF NOT EXISTS ix_chunk_embedding_hnsw
                    ON chunk USING hnsw (embedding_vec vector_cosine_ops);
            ELSE
                RAISE NOTICE 'pgvector 未安装，chunk 向量检索走应用层余弦计算';
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    # 回滚顺序与建表顺序严格相反：先删有外键依赖的子表，再删被引用的父表，
    # 否则 PostgreSQL 会因外键约束拒绝删除。RLS 策略与索引随表一起删除，
    # 无需单独 DROP；pgvector 扩展保留不动（其他库可能正在使用）。
    op.drop_index(op.f('ix_task_run_status'), table_name='task_run')
    op.drop_index(op.f('ix_task_run_created_at'), table_name='task_run')
    op.drop_index(op.f('ix_task_run_conversation_id'), table_name='task_run')
    op.drop_table('task_run')
    op.drop_index(op.f('ix_hidden_response_run_id'), table_name='hidden_response')
    op.drop_table('hidden_response')
    op.drop_table('workflow_version')
    op.drop_table('workflow_agent')
    op.drop_index(op.f('ix_message_conversation_id'), table_name='message')
    op.drop_table('message')
    op.drop_index(op.f('ix_chunk_document_id'), table_name='chunk')
    op.drop_table('chunk')
    op.drop_table('agent_skill')
    op.drop_table('agent_mcp')
    op.drop_table('agent_kb')
    op.drop_index(op.f('ix_workflow_application_id'), table_name='workflow')
    op.drop_table('workflow')
    op.drop_index(op.f('ix_document_kb_id'), table_name='document')
    op.drop_table('document')
    op.drop_index(op.f('ix_conversation_application_id'), table_name='conversation')
    op.drop_table('conversation')
    op.drop_table('api_key')
    op.drop_index(op.f('ix_agent_application_id'), table_name='agent')
    op.drop_table('agent')
    op.drop_table('skill')
    op.drop_table('model_config')
    op.drop_table('member')
    op.drop_table('mcp_server')
    op.drop_table('knowledge_base')
    op.drop_index(op.f('ix_application_tenant_id'), table_name='application')
    op.drop_index(op.f('ix_application_default_workflow_id'), table_name='application')
    op.drop_table('application')
    op.drop_index(op.f('ix_trace_event_run_id'), table_name='trace_event')
    op.drop_table('trace_event')
    op.drop_table('tenant')
    op.drop_table('checkpoint')
    op.drop_index(op.f('ix_audit_log_tenant_id'), table_name='audit_log')
    op.drop_table('audit_log')
