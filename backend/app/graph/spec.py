"""工作流规格：把「数据库里的 Agent」+「工作流图定义」解析成可执行描述。

为什么要两层：
- Agent 的提示词、模型、知识库绑定是租户可配置的，存在数据库里；
- 工作流的拓扑（谁连谁、路由策略、最大轮次）存在 workflow.graph_definition 里；
- 图执行只依赖本文件的不可变对象，避免在节点里到处查库。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import Agent


@dataclass(frozen=True)
class AgentSpec:
    """单个 Agent 的执行规格。"""

    id: str
    name: str
    keywords: list[str] = field(default_factory=list)
    prompt: str = ""
    is_default: bool = False
    # M2 新增：模型与知识库
    model: str | None = None
    temperature: float | None = None
    kb_ids: tuple[str, ...] = ()
    max_context_len: int = 8000


@dataclass(frozen=True)
class WorkflowSpec:
    """一张可执行的工作流图。"""

    agents: list[AgentSpec]
    router: str = "hybrid"  # semantic / rule / hybrid
    default_agent: str | None = None
    max_iterations: int = 20
    confidence_threshold: float = 0.6
    # 是否把知识库检索结果注入上下文
    rag_enabled: bool = True
    rag_top_k: int = 4

    def agent(self, agent_id: str | None) -> AgentSpec | None:
        if not agent_id:
            return None
        for item in self.agents:
            if item.id == agent_id:
                return item
        return None

    @property
    def fallback_agent(self) -> AgentSpec | None:
        """兜底 Agent：默认 Agent > 标记 is_default 的 > 第一个。

        兜底是「正常路由」而非降级，只有校验失败/超时才叫降级。
        """
        if self.default_agent:
            found = self.agent(self.default_agent)
            if found:
                return found
        for item in self.agents:
            if item.is_default:
                return item
        return self.agents[0] if self.agents else None

    # ------------------------------------------------------------------ 构造
    @classmethod
    def from_definition(cls, definition: dict) -> WorkflowSpec:
        """仅从 JSON 定义构造（无数据库时的最小可用规格）。"""
        raw_agents = definition.get("agents") or []
        agents = [
            AgentSpec(
                id=str(item.get("id")),
                name=item.get("name") or str(item.get("id")),
                keywords=list(item.get("keywords") or []),
                prompt=item.get("prompt") or "",
                is_default=bool(item.get("is_default")),
                model=item.get("model"),
                temperature=item.get("temperature"),
                kb_ids=tuple(item.get("kb_ids") or ()),
                max_context_len=int(item.get("max_context_len", 8000)),
            )
            for item in raw_agents
            if item.get("id")
        ]
        if not agents:
            # 保证空配置也能跑：给一个默认 Agent，避免开局就失败
            agents = [AgentSpec(id="default", name="默认助手", is_default=True)]

        return cls(
            agents=agents,
            router=definition.get("router", "hybrid"),
            default_agent=definition.get("default_agent"),
            max_iterations=int(definition.get("max_iterations", 20)),
            confidence_threshold=float(definition.get("confidence_threshold", 0.6)),
            rag_enabled=bool(definition.get("rag_enabled", True)),
            rag_top_k=int(definition.get("rag_top_k", 4)),
        )

    @classmethod
    def from_db(
        cls,
        agents: list[Agent],
        definition: dict,
        model_names: dict[str, str] | None = None,
    ) -> WorkflowSpec:
        """用数据库中的 Agent 覆盖图定义中的 Agent 列表。

        路由参数（router / threshold / 默认 Agent）仍以图定义为准，
        但提示词、模型、温度以数据库为唯一事实来源。

        `model_names` 是「model_config_id → 厂商模型名」的映射，由调用方一次性查好。
        为什么要映射而不是让图节点自己查库：
        - 图节点是纯执行逻辑，不应持有数据库会话（否则 checkpointer 序列化会出问题）；
        - 同一请求内多个 Agent 可能引用同一模型，预取可避免 N+1 查询。
        映射里查不到的 ID 会退化为 None，由网关回落到默认模型——
        这是刻意的降级：模型配置被删掉不应让整个对话失败。
        """
        base = cls.from_definition({**definition, "agents": []})
        if not agents:
            return base

        names = model_names or {}
        default_from_def = definition.get("default_agent")
        keyword_map = definition.get("keywords") or {}
        specs: list[AgentSpec] = []
        for agent in agents:
            model_name = names.get(str(agent.model_config_id)) if agent.model_config_id else None
            specs.append(
                AgentSpec(
                    id=str(agent.id),
                    name=agent.name,
                    keywords=list(keyword_map.get(str(agent.id), [])),
                    prompt=agent.system_prompt or "",
                    is_default=str(agent.id) == default_from_def,
                    model=model_name,
                    temperature=agent.temperature,
                    kb_ids=(),  # 知识库绑定由 retriever 按 agent_id 查询，避免此处拉全表
                    max_context_len=agent.max_context_len,
                )
            )
        return cls(
            agents=specs,
            router=definition.get("router", "hybrid"),
            default_agent=default_from_def or str(specs[0].id),
            max_iterations=int(definition.get("max_iterations", base.max_iterations)),
            confidence_threshold=float(
                definition.get("confidence_threshold", base.confidence_threshold)
            ),
            rag_enabled=bool(definition.get("rag_enabled", True)),
            rag_top_k=int(definition.get("rag_top_k", base.rag_top_k)),
        )
