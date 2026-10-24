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


# ---------------------------------------------------------------- from_db 取数
class _AgentStub:
    """只实现 spec.from_db 会读到的属性，避免为这条用例建库。"""

    def __init__(self, id, name, keywords, is_default=False):
        self.id = id
        self.name = name
        self.keywords = keywords
        self.is_default = is_default
        self.system_prompt = ""
        self.model_config_id = None
        self.temperature = 0.7
        self.max_context_len = 8000


def _db_agents():
    return [
        _AgentStub("after", "售后助手", ["退货", "退款"]),
        _AgentStub("general", "通用助手", [], is_default=True),
    ]


def test_from_db_uses_agent_keywords_when_graph_has_no_map():
    """回归：前端编排图不维护 keywords 映射时，规则路由必须仍能命中。

    早期实现只读 definition["keywords"]，导致所有 Agent 关键词为空，
    任何输入都退化成 hybrid:fallback——路由面板看起来「能跑」，其实从没路由过。
    """
    spec = WorkflowSpec.from_db(_db_agents(), {"router": "hybrid", "default_agent": "general"})
    assert spec.agent("after").keywords == ["退货", "退款"]


def test_from_db_prefers_graph_keyword_override():
    spec = WorkflowSpec.from_db(_db_agents(), {"keywords": {"after": ["换货"]}})
    assert spec.agent("after").keywords == ["换货"]


def test_from_db_falls_back_to_db_default_agent():
    """图里没指定默认 Agent 时认数据库的 is_default，而不是列表第一个。"""
    spec = WorkflowSpec.from_db(_db_agents(), {})
    assert spec.default_agent == "general"


@pytest.mark.asyncio
async def test_hybrid_router_hits_keywords_from_db():
    spec = WorkflowSpec.from_db(
        _db_agents(),
        {"router": "hybrid", "default_agent": "general", "confidence_threshold": 0.55},
    )
    decision = await build_router("hybrid").route("你们支持七天无理由退货吗？", spec, 0.55)
    assert decision.strategy == "hybrid:rule"
    assert decision.selected == "after"
