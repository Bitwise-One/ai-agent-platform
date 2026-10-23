"""LangGraph 图构建：路由 → 执行 → 校验 → 终态，全分支必然收敛到终态。

对应 design/langgraph.md §2/§5。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from langgraph.graph import END, START, StateGraph

from app.core.config import get_settings
from app.graph import guards
from app.graph.routing import build_router
from app.graph.routing.base import LLMClassifier
from app.graph.spec import AgentSpec, WorkflowSpec
from app.graph.state import AgentState
from app.models import TaskStatus


@dataclass
class AgentResult:
    reply: str
    tokens: int = 0
    hidden: list[dict] = field(default_factory=list)


# Agent 执行器：由上层注入（M1 默认模板回显，M2 接入模型网关）
AgentRunner = Callable[[AgentSpec, AgentState], Awaitable[AgentResult]]


async def default_agent_runner(agent: AgentSpec, state: AgentState) -> AgentResult:
    """M1 默认实现：无 LLM 也能跑通全链路，用于自检与测试。"""
    user_input = state.get("user_input", "")
    reply = f"[{agent.name}] 已收到：{user_input}"
    if agent.prompt:
        reply = f"[{agent.name}] {agent.prompt}\n已收到：{user_input}"
    return AgentResult(reply=reply, tokens=0)


def build_graph(
    spec: WorkflowSpec,
    *,
    runner: AgentRunner | None = None,
    classifier: LLMClassifier | None = None,
    max_iterations: int | None = None,
):
    settings = get_settings()
    runner = runner or default_agent_runner
    iteration_limit = max_iterations or spec.max_iterations or settings.max_iterations
    router = build_router(spec.router, classifier)

    async def prepare(state: AgentState) -> AgentState:
        text = (state.get("user_input") or "").strip()
        if not text:
            return {"terminal_status": TaskStatus.FAILED, "degraded": False,
                    "guard_reason": "输入为空"}
        return {}

    async def route(state: AgentState) -> AgentState:
        exceeded = guards.check_iteration(state.get("iteration_count", 1), iteration_limit)
        if exceeded:
            return {
                "degraded": True,
                "guard_reason": exceeded,
                "route_selected": None,
                "route_reason": exceeded,
            }

        decision = await router.route(
            state.get("user_input", ""), spec, spec.confidence_threshold
        )
        return {
            "route_strategy": decision.strategy,
            "route_selected": decision.selected,
            "route_confidence": decision.confidence,
            "route_reason": decision.reason,
            "route_candidates": decision.candidates,
        }

    async def run_agent(state: AgentState) -> AgentState:
        agent = spec.agent(state.get("route_selected"))
        if agent is None:
            return {"degraded": True, "guard_reason": "路由未命中可执行 Agent"}
        result = await runner(agent, state)
        return {
            "current_agent": agent.id,
            "draft_output": result.reply,
            "token_usage": result.tokens,
            "last_outputs": [result.reply],
            "hidden_responses": result.hidden,
        }

    async def guard(state: AgentState) -> AgentState:
        passed, reason = guards.guard_output(state.get("draft_output"))
        if passed and guards.is_stalled(state.get("last_outputs", [])):
            passed, reason = False, "检测到连续无进展（疑似死循环）"
        return {"guard_passed": passed, "guard_reason": reason}

    async def fallback(state: AgentState) -> AgentState:
        agent = spec.fallback_agent
        if agent is None:
            return {"degraded": True, "draft_output": None}
        result = await runner(agent, state)
        return {
            "degraded": True,
            "draft_output": result.reply,
            "current_agent": agent.id,
            "token_usage": result.tokens,
        }

    async def finalize(state: AgentState) -> AgentState:
        if state.get("terminal_status") in TaskStatus.TERMINAL:
            return {}
        if state.get("degraded"):
            status = TaskStatus.DEGRADED if state.get("draft_output") else TaskStatus.FAILED
        elif state.get("guard_passed") and state.get("draft_output"):
            status = TaskStatus.COMPLETED
        else:
            status = TaskStatus.FAILED
        return {"terminal_status": status}

    # ---- 条件边 ----
    def after_prepare(state: AgentState) -> str:
        return "finalize" if state.get("terminal_status") == TaskStatus.FAILED else "route"

    def after_route(state: AgentState) -> str:
        if state.get("route_selected"):
            return "agent"
        return "fallback"

    def after_guard(state: AgentState) -> str:
        if state.get("guard_passed"):
            return "finalize"
        return "fallback"

    graph = StateGraph(AgentState)
    graph.add_node("prepare", prepare)
    graph.add_node("route", route)
    graph.add_node("agent", run_agent)
    graph.add_node("guard", guard)
    graph.add_node("fallback", fallback)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "prepare")
    graph.add_conditional_edges(
        "prepare", after_prepare, {"route": "route", "finalize": "finalize"}
    )
    graph.add_conditional_edges(
        "route", after_route, {"agent": "agent", "fallback": "fallback"}
    )
    graph.add_edge("agent", "guard")
    graph.add_conditional_edges(
        "guard", after_guard, {"finalize": "finalize", "fallback": "fallback"}
    )
    graph.add_edge("fallback", "finalize")
    graph.add_edge("finalize", END)

    return graph.compile()
