"""工作流规格：从 workflow.graph_definition 解析出的可执行描述。"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class AgentSpec:
    id: str
    name: str
    keywords: list[str] = field(default_factory=list)
    prompt: str = ""
    is_default: bool = False


@dataclass(frozen=True)
class WorkflowSpec:
    agents: list[AgentSpec]
    router: str = "hybrid"  # semantic / rule / hybrid
    default_agent: str | None = None
    max_iterations: int = 20
    confidence_threshold: float = 0.6

    def agent(self, agent_id: str | None) -> AgentSpec | None:
        if not agent_id:
            return None
        for item in self.agents:
            if item.id == agent_id:
                return item
        return None

    @property
    def fallback_agent(self) -> AgentSpec | None:
        if self.default_agent:
            found = self.agent(self.default_agent)
            if found:
                return found
        for item in self.agents:
            if item.is_default:
                return item
        return self.agents[0] if self.agents else None

    @classmethod
    def from_definition(cls, definition: dict) -> "WorkflowSpec":
        """从 JSON 定义解析；缺省时给出一个可运行的默认单 Agent 规格。"""
        raw_agents = definition.get("agents") or []
        agents = [
            AgentSpec(
                id=str(item.get("id")),
                name=item.get("name") or str(item.get("id")),
                keywords=list(item.get("keywords") or []),
                prompt=item.get("prompt") or "",
                is_default=bool(item.get("is_default")),
            )
            for item in raw_agents
            if item.get("id")
        ]
        if not agents:
            agents = [AgentSpec(id="default", name="默认助手", is_default=True)]

        return cls(
            agents=agents,
            router=definition.get("router", "hybrid"),
            default_agent=definition.get("default_agent"),
            max_iterations=int(definition.get("max_iterations", 20)),
            confidence_threshold=float(definition.get("confidence_threshold", 0.6)),
        )
