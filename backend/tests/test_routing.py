"""路由策略单测：规则命中、置信度、兜底、混合降级。"""

import pytest

from app.graph.routing import RuleRouter, build_router
from app.graph.spec import AgentSpec, WorkflowSpec


def make_spec(router: str = "hybrid") -> WorkflowSpec:
    return WorkflowSpec(
        agents=[
            AgentSpec(id="contract", name="合同助手", keywords=["合同", "条款"]),
            AgentSpec(id="billing", name="账单助手", keywords=["发票", "账单"]),
            AgentSpec(id="default", name="默认助手", is_default=True),
        ],
        router=router,
        default_agent="default",
        confidence_threshold=0.6,
    )


@pytest.mark.asyncio
async def test_rule_router_hits_keyword():
    decision = await RuleRouter().route("请帮我看看这份合同的条款", make_spec(), 0.6)
    assert decision.selected == "contract"
    assert decision.confidence >= 0.6
    assert "合同" in decision.reason


@pytest.mark.asyncio
async def test_rule_router_no_match_routes_to_default():
    """规则无命中时走默认 Agent（正常路由，不视为降级）。"""
    decision = await RuleRouter().route("今天天气不错", make_spec(), 0.6)
    assert decision.selected == "default"
    assert decision.confidence == 0.0
    assert decision.strategy == "rule:default"


@pytest.mark.asyncio
async def test_hybrid_router_falls_back_to_default():
    decision = await build_router("hybrid").route("今天天气不错", make_spec(), 0.6)
    assert decision.strategy == "hybrid:fallback"
    assert decision.selected == "default"


@pytest.mark.asyncio
async def test_hybrid_router_uses_rule_when_confident():
    decision = await build_router("hybrid").route("发票金额不对", make_spec(), 0.6)
    assert decision.strategy == "hybrid:rule"
    assert decision.selected == "billing"
