"""添加列级中文注释（COMMENT ON COLUMN）。

为什么单独一条迁移，而不是改首版迁移：
首版 `fdbe27c865ca` 已经在开发库/测试库里执行过，改它不会让已有库获得注释。
新增一条迁移，才能让「已存在的库」和「从零建的库」都拿到同一份注释。

为什么只有 PostgreSQL 生效：
SQLite 既没有 `COMMENT ON COLUMN` 语法，也没有地方存注释，本地开发与 CI 用的
就是 SQLite。所以这里按方言短路——在 SQLite 上这条迁移是空操作，
注释的验收必须在 PostgreSQL 上做（见 AGENTS.md §2.3）。

注释内容来自 `app/models/` 的 column comment，是「字段业务含义」的唯一事实来源；
新增字段时在 ORM 里写 comment，再补一条同样的 COMMENT ON 迁移即可。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "a6ce26b3419c"
down_revision = "fdbe27c865ca"
branch_labels = None
depends_on = None


# 表 -> 列 -> 中文说明。顺序与 ORM 建表顺序一致，便于对照。
COLUMN_COMMENTS: dict[str, dict[str, str]] = {
    "audit_log": {
        "id": "主键，UUID 全局唯一标识",
        "tenant_id": "所属租户；可空（未确定租户的事件），RLS 额外放行 NULL",
        "application_id": "关联应用，可空",
        "conversation_id": "关联会话，可空",
        "actor": "操作者标识（用户/服务账号），可空",
        "action": "动作类型（如 login/create/update/delete）",
        "object_type": "被操作对象类型（如 application/agent/document），可空",
        "object_id": "被操作对象 ID，可空",
        "result": "操作结果：success/denied/failed，可空",
        "detail": "结构化上下文（前后值差异、错误摘要等）",
        "source_ip": "来源 IP，可空",
        "request_id": "请求追踪 ID，便于串联链路，可空",
        "created_at": "创建时间（服务端写入，UTC）",
    },
    "checkpoint": {
        "thread_id": "线程 ID，直接取 conversation_id（一条会话一条线程），联合主键之一",
        "checkpoint_ns": "检查点命名空间，联合主键之一，默认空串",
        "checkpoint_id": "检查点 ID，联合主键之一",
        "parent_checkpoint_id": "父检查点 ID，用于回溯执行路径，可空",
        "type": "类型：channel（通道状态）/task（任务），可空",
        "checkpoint": "图执行的完整状态快照",
        "metadata": "LangGraph 写入的元数据（来源、步数等）",
    },
    "tenant": {
        "id": "主键，UUID",
        "name": "租户名称",
        "slug": "全局唯一可读标识（URL/子域名）",
        "status": "租户状态：active/suspended/deleted",
        "quota": "配额策略：应用数、agent 数、存储、调用量上限等",
        "created_at": "创建时间（服务端写入，UTC）",
        "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
        "deleted_at": "软删除时间，非空表示已删除（查询默认过滤）",
    },
    "trace_event": {
        "event_id": "主键，UUID",
        "run_id": "所属任务运行 ID（一次执行产生多条事件）",
        "node": "图节点名称/标识",
        "kind": "事件种类：llm/tool/node/route",
        "latency_ms": "该节点耗时（毫秒）",
        "tokens_in": "输入 token 数",
        "tokens_out": "输出 token 数",
        "status": "节点状态：success/error/retry",
        "detail": "结构化明细（模型名、错误、重试原因等）",
        "created_at": "创建时间（服务端写入，UTC）",
    },
    "application": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖此列）",
        "name": "应用名称",
        "description": "应用描述",
        "icon": "图标 URL",
        "default_workflow_id": "默认工作流（逻辑外键，无物理 FK 避免循环依赖）",
        "default_model_params": "默认模型参数（temperature、max_tokens 等）",
        "status": "应用状态：active/suspended/deleted",
        "created_at": "创建时间（服务端写入，UTC）",
        "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
        "deleted_at": "软删除时间，非空表示已删除（查询默认过滤）",
    },
    "knowledge_base": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "name": "知识库名称",
        "description": "知识库描述",
        "embedding_model": "使用的向量模型名，切换模型需重建索引",
        "vector_dim": "向量维度，维度不一致会导致相似度计算失效",
        "created_at": "创建时间（服务端写入，UTC）",
        "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
        "deleted_at": "软删除时间，非空表示已删除（查询默认过滤）",
    },
    "mcp_server": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "name": "服务名称",
        "transport": "传输方式：stdio/sse/http",
        "config": "连接配置（命令/URL/鉴权头，敏感值脱敏后存储）",
        "status": "服务状态：active/suspended/deleted",
        "created_at": "创建时间（服务端写入，UTC）",
        "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
    },
    "member": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "user_id": "用户标识（对接 SSO/外部用户体系）",
        "role": "角色：admin/developer/member",
        "created_at": "创建时间（服务端写入，UTC）",
    },
    "model_config": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "name": "逻辑模型名（业务侧引用）",
        "provider": "厂商：openai/anthropic/qwen 等",
        "model_name": "厂商模型名（实际调用用）",
        "context_len": "上下文窗口长度（token）",
        "price_in": "每 1K 输入 token 单价（元）",
        "price_out": "每 1K 输出 token 单价（元）",
        "capabilities": "能力标签（如 vision、function_call、streaming）",
        "status": "状态：active/suspended",
        "created_at": "创建时间（服务端写入，UTC）",
    },
    "skill": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "name": "技能名称",
        "description": "技能描述",
        "params_schema": "入参 JSON Schema（校验与渲染表单用）",
        "trigger": "触发条件（关键词/规则）",
        "source": "来源：local（自建）/marketplace（内置）",
        "created_at": "创建时间（服务端写入，UTC）",
        "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
    },
    "agent": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "application_id": "所属应用",
        "name": "Agent 名称",
        "system_prompt": "系统提示词（行为约束/角色设定）",
        "model_config_id": "引用的模型配置（可继承应用级默认值）",
        "temperature": "采样温度（默认 0.7），越高越发散",
        "max_context_len": "最大上下文长度（token，默认 8000）",
        "memory_strategy": "记忆策略：sliding_window/summary/hybrid",
        "keywords": "路由关键词（含 re: 前缀表示正则）",
        "is_default": "是否兜底 Agent（路由无命中时回落）",
        "status": "状态：active/suspended/deleted",
        "created_at": "创建时间（服务端写入，UTC）",
        "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
        "deleted_at": "软删除时间，非空表示已删除（查询默认过滤）",
    },
    "api_key": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "application_id": "关联应用（可为平台级，故可空）",
        "key_hash": "密钥哈希（明文永不落库）",
        "prefix": "可读前缀，控制台展示前若干位便于识别",
        "scope": "权限范围：ro/rw/admin",
        "expires_at": "过期时间，可空表示永不过期",
        "status": "状态：active/revoked/expired",
        "last_used_at": "最近使用时间，用于清理闲置密钥",
        "created_at": "创建时间（服务端写入，UTC）",
    },
    "conversation": {
        "id": "主键，UUID；同时作为 LangGraph thread_id",
        "tenant_id": "所属租户（RLS 依赖）",
        "application_id": "所属应用",
        "user_id": "终端用户标识（可对接外部系统）",
        "title": "会话标题（首条消息摘要等）",
        "status": "状态：active/archived/closed",
        "metadata": "扩展信息（渠道、设备、来源等）",
        "archived_at": "归档时间，非空表示已归档",
        "created_at": "创建时间（服务端写入，UTC）",
        "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
    },
    "document": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "kb_id": "所属知识库",
        "title": "文档标题",
        "source": "原始来源（URL/上传路径）",
        "file_type": "文件类型（pdf/md/docx 等）",
        "status": "状态：pending/parsing/indexed/failed",
        "access_scope": "文档级访问范围（空表示租户内可见）",
        "created_at": "创建时间（服务端写入，UTC）",
        "deleted_at": "软删除时间，非空表示已删除（查询默认过滤）",
    },
    "workflow": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "application_id": "所属应用",
        "name": "工作流名称",
        "description": "工作流描述",
        "graph_definition": "LangGraph 图结构（nodes/edges/路由策略）",
        "current_version_id": "当前生效的版本快照 ID",
        "status": "状态：draft/published/archived",
        "created_at": "创建时间（服务端写入，UTC）",
        "updated_at": "最后更新时间（任意写操作自动刷新，UTC）",
    },
    "agent_kb": {
        "agent_id": "关联 Agent（联合主键）",
        "kb_id": "关联知识库（联合主键）",
    },
    "agent_mcp": {
        "agent_id": "关联 Agent（联合主键）",
        "mcp_id": "关联 MCP 服务（联合主键）",
    },
    "agent_skill": {
        "agent_id": "关联 Agent（联合主键）",
        "skill_id": "关联技能（联合主键）",
    },
    "chunk": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "document_id": "所属文档",
        "seq": "块序号（同文档内递增，保证切分顺序可重放）",
        "content": "分块纯文本内容",
        "embedding": "向量（float 列表），无向量库时用于应用层余弦检索",
        "vector_id": "外部向量库中的 ID（若向量另存）",
        "token_count": "块的 token 数（用于预算/截断）",
    },
    "message": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "conversation_id": "所属会话",
        "role": "角色：user/assistant/system/tool",
        "content": "消息文本（tool 角色可能仅含 tool_calls）",
        "tool_calls": "模型发起的工具调用（参数与结果），回放免重调",
        "created_at": "创建时间（服务端写入，UTC）",
    },
    "workflow_agent": {
        "workflow_id": "关联工作流（联合主键）",
        "agent_id": "关联 Agent（联合主键）",
    },
    "workflow_version": {
        "id": "主键，UUID",
        "workflow_id": "所属工作流",
        "version": "版本号（同工作流内单调递增）",
        "snapshot": "该版本完整图定义快照",
        "changelog": "变更说明",
        "status": "状态：draft/released/rolled_back",
        "created_at": "创建时间（服务端写入，UTC）",
    },
    "hidden_response": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "message_id": "关联消息（可空）",
        "run_id": "所属任务运行 ID",
        "action": "动作类型（open_form/navigate/trigger_ticket 等）",
        "payload": "结构化动作参数",
        "created_at": "创建时间（服务端写入，UTC）",
    },
    "task_run": {
        "id": "主键，UUID",
        "tenant_id": "所属租户（RLS 依赖）",
        "conversation_id": "所属会话",
        "workflow_version_id": "关联工作流版本快照（执行时锁定版本）",
        "status": "状态机：created/running/waiting_human/completed/degraded/failed/timed_out/cancelled/escalated",
        "input": "本次执行的输入（query、上下文引用等）",
        "output": "执行最终输出（含回复、动作）",
        "error": "错误信息（异常类型/堆栈摘要）",
        "token_usage": "累计 token 消耗",
        "cost": "本次执行成本（元，12,6 精度）",
        "started_at": "开始时间",
        "finished_at": "结束时间",
        "created_at": "创建时间（服务端写入，UTC）",
    },
}


def _quote(value: str) -> str:
    """COMMENT 是 DDL，不能用绑定参数，只能内联字符串——这里做转义。"""
    return value.replace("'", "''")


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        # SQLite/MySQL 等没有列注释语义，跳过；见模块 docstring
        return
    for table, columns in COLUMN_COMMENTS.items():
        for column, comment in columns.items():
            op.execute(
                sa.text(f'COMMENT ON COLUMN "{table}"."{column}" IS \'{_quote(comment)}\'')
            )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table, columns in COLUMN_COMMENTS.items():
        for column in columns:
            op.execute(sa.text(f'COMMENT ON COLUMN "{table}"."{column}" IS NULL'))
