"""语义路由：由 LLM 判断意图，在候选 Agent 中优选。

LLM 分类器由模型网关注入；未注入时返回未决策，由上层降级到规则/默认 Agent。
"""

from app.graph.routing.base import LLMClassifier, RouteDecision
from app.graph.spec import AgentSpec, WorkflowSpec


class SemanticRouter:
    def __init__(self, classifier: LLMClassifier | None = None) -> None:
        self._classifier = classifier

    async def route(self, text: str, spec: WorkflowSpec, threshold: float) -> RouteDecision:
        return await self.route_within(text, spec, spec.agents, threshold)

    async def route_within(
        self,
        text: str,
        spec: WorkflowSpec,
        candidates: list[AgentSpec],
        threshold: float,
    ) -> RouteDecision:
        if self._classifier is None or not candidates:
            return RouteDecision(strategy="semantic", reason="未配置 LLM 分类器")

        agent_id, confidence, reason = await self._classifier.classify(text, candidates)
        return RouteDecision(
            strategy="semantic",
            selected=agent_id if confidence >= threshold else None,
            confidence=confidence,
            reason=reason,
            candidates=[{"agent_id": agent_id, "confidence": confidence}],
            fallback=spec.fallback_agent.id if spec.fallback_agent else None,
        )
