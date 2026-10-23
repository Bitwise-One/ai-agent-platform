"""混合路由：规则先过滤候选集，语义在候选集内精选，最后兜底默认 Agent。

对应 PRD §4.6 混合路由模式。
"""

from app.graph.routing.base import LLMClassifier, RouteDecision
from app.graph.routing.rule import RuleRouter
from app.graph.routing.semantic import SemanticRouter
from app.graph.spec import WorkflowSpec


class HybridRouter:
    def __init__(self, classifier: LLMClassifier | None = None) -> None:
        self._rule = RuleRouter()
        self._semantic = SemanticRouter(classifier)

    async def route(self, text: str, spec: WorkflowSpec, threshold: float) -> RouteDecision:
        rule = await self._rule.route(text, spec, threshold)
        if rule.decided and rule.confidence >= threshold:
            rule.strategy = "hybrid:rule"
            return rule

        # 规则未命中或置信不足：若规则给出候选集则在其内语义精选，否则全量语义
        candidates = spec.agents
        if rule.candidates:
            ids = {c["agent_id"] for c in rule.candidates}
            narrowed = [a for a in spec.agents if a.id in ids]
            if narrowed:
                candidates = narrowed

        semantic = await self._semantic.route_within(text, spec, candidates, threshold)
        if semantic.decided:
            semantic.strategy = "hybrid:semantic"
            return semantic

        # 全部失败：兜底默认 Agent，并标记为降级依据
        fallback = spec.fallback_agent
        return RouteDecision(
            strategy="hybrid:fallback",
            selected=fallback.id if fallback else None,
            confidence=0.0,
            reason="规则与语义均未命中，回退默认 Agent",
            candidates=rule.candidates,
            fallback=fallback.id if fallback else None,
        )


def build_router(name: str, classifier: LLMClassifier | None = None):
    normalized = (name or "hybrid").lower()
    if normalized == "rule":
        return RuleRouter()
    if normalized == "semantic":
        return SemanticRouter(classifier)
    return HybridRouter(classifier)
