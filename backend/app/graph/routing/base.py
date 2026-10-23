"""路由策略接口与数据结构（对应 design/langgraph.md §3）。"""

from dataclasses import dataclass, field
from typing import Protocol

from app.graph.spec import AgentSpec, WorkflowSpec


@dataclass
class RouteDecision:
    strategy: str
    selected: str | None = None
    confidence: float = 0.0
    reason: str = ""
    candidates: list[dict] = field(default_factory=list)
    fallback: str | None = None

    @property
    def decided(self) -> bool:
        return self.selected is not None


class RouterStrategy(Protocol):
    async def route(
        self, text: str, spec: WorkflowSpec, threshold: float
    ) -> RouteDecision: ...


class LLMClassifier(Protocol):
    """语义路由依赖的 LLM 分类能力（由模型网关注入）。"""

    async def classify(self, text: str, candidates: list[AgentSpec]) -> tuple[str, float, str]:
        """返回 (agent_id, confidence, reason)。"""
        ...
