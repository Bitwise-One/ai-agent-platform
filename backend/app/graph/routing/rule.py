"""规则路由：关键词/正则确定性匹配，零 token 成本。"""

import re

from app.graph.routing.base import RouteDecision
from app.graph.spec import WorkflowSpec


class RuleRouter:
    async def route(self, text: str, spec: WorkflowSpec, threshold: float) -> RouteDecision:
        lowered = text.lower()
        scores: list[tuple[int, str, list[str]]] = []

        for agent in spec.agents:
            hits = [kw for kw in agent.keywords if kw and kw.lower() in lowered]
            # 正则形态关键词：re:pattern
            for kw in agent.keywords:
                if kw.startswith("re:"):
                    try:
                        if re.search(kw[3:], text):
                            hits.append(kw)
                    except re.error:
                        continue
            if hits:
                scores.append((len(hits), agent.id, hits))

        if not scores:
            # 规则是确定性策略：无命中即走默认 Agent，这是正常路由而非降级
            fallback = spec.fallback_agent
            return RouteDecision(
                strategy="rule:default",
                selected=fallback.id if fallback else None,
                confidence=0.0,
                reason="无关键词命中，使用默认 Agent",
                candidates=[],
                fallback=fallback.id if fallback else None,
            )

        scores.sort(key=lambda item: item[0], reverse=True)
        top_hits, top_id, matched = scores[0]

        # 规则是确定性的：单次命中即高置信，命中越多越接近 1.0
        def _confidence(hits: int) -> float:
            return min(1.0, 0.7 + 0.15 * hits)

        confidence = _confidence(top_hits)
        candidates = [
            {"agent_id": agent_id, "confidence": _confidence(hits), "matched": kw}
            for hits, agent_id, kw in scores[:5]
        ]
        return RouteDecision(
            strategy="rule",
            selected=top_id,
            confidence=confidence,
            reason=f"关键词命中: {', '.join(matched[:3])}",
            candidates=candidates,
            fallback=spec.fallback_agent.id if spec.fallback_agent else None,
        )
