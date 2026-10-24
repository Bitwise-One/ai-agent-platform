"""LangGraph 图构建：路由 → 检索 → 执行 → 校验 → 终态。

核心不变量（PRD FR-R-01「结束态必达」）：
- 图里每一条分支都必须收敛到 `finalize`；
- `finalize` 是唯一出口，负责把状态归一成六种终态之一；
- 任何异常都会在 runner 层被捕获并转成 FAILED，不会让请求悬挂。

图结构：
    START → prepare → route → rag → agent → guard → finalize → END
                        └──────────────→ fallback ─┘
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from langgraph.graph import END, START, StateGraph

from app.core.config import get_settings
from app.graph import guards
from app.graph.emitter import emit, reset_emitter, set_emitter
from app.graph.routing import build_router
from app.graph.routing.base import LLMClassifier
from app.graph.spec import AgentSpec, WorkflowSpec
from app.graph.state import AgentState
from app.models import TaskStatus


@dataclass
class AgentResult:
    """Agent 执行结果。"""

    reply: str
    tokens: int = 0
    hidden: list[dict] = field(default_factory=list)


# Agent 执行器：由上层注入（默认模板回显，M2 起为模型网关实现）
AgentRunner = Callable[[AgentSpec, AgentState], Awaitable[AgentResult]]

# 知识库检索器：(agent_id, 查询文本, top_k) -> 命中片段列表
RagRetriever = Callable[[str, str, int], Awaitable[list[dict]]]

# 流式事件发射器：把事件推给 SSE 队列
EventEmitter = Callable[[dict], None]


async def default_agent_runner(agent: AgentSpec, state: AgentState) -> AgentResult:
    """最小可用执行器：不调用模型，只做模板回显。

    保留它有两个用途：单元测试无网络依赖；模型网关整体不可用时的最后兜底。
    """
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
    retriever: RagRetriever | None = None,
    emitter: EventEmitter | None = None,
    max_iterations: int | None = None,
):
    """编译一张可执行图。

    Args:
        spec: 工作流规格（Agent 列表 + 路由配置）。
        runner: Agent 执行器；默认模板回显，线上注入模型网关实现。
        classifier: 语义路由所需的 LLM 分类器，缺省时语义路由自动让位规则。
        retriever: 知识库检索器，缺省则不注入 RAG 上下文。
        emitter: 流式事件发射器，缺省则退化为非流式执行。
        max_iterations: 最大轮次，超出即熔断。
    """
    settings = get_settings()
    runner = runner or default_agent_runner
    iteration_limit = max_iterations or spec.max_iterations or settings.max_iterations
    router = build_router(spec.router, classifier)

    # ------------------------------------------------------------------ 节点
    async def prepare(state: AgentState) -> AgentState:
        """入口校验：空输入直接判失败，避免无意义地消耗模型调用。"""
        text = (state.get("user_input") or "").strip()
        emit({"type": "status", "status": TaskStatus.RUNNING})
        if not text:
            return {
                "terminal_status": TaskStatus.FAILED,
                "degraded": False,
                "guard_reason": "输入为空",
            }
        return {}

    async def route(state: AgentState) -> AgentState:
        """智能路由：选择本次执行的 Agent。"""
        exceeded = guards.check_iteration(state.get("iteration_count", 1), iteration_limit)
        if exceeded:
            # 轮次熔断：不再调用模型，直接交给 fallback
            return {
                "degraded": True,
                "guard_reason": exceeded,
                "route_selected": None,
                "route_reason": exceeded,
            }

        decision = await router.route(
            state.get("user_input", ""), spec, spec.confidence_threshold
        )
        # 把路由决策推给前端，便于可视化「为什么走了这条路径」
        emit(
            {
                "type": "route",
                "strategy": decision.strategy,
                "selected": decision.selected,
                "confidence": round(decision.confidence, 3),
                "reason": decision.reason,
            }
        )
        return {
            "route_strategy": decision.strategy,
            "route_selected": decision.selected,
            "route_confidence": decision.confidence,
            "route_reason": decision.reason,
            "route_candidates": decision.candidates,
        }

    async def rag(state: AgentState) -> AgentState:
        """知识库检索：把命中的片段整理成上下文，供 Agent 引用。"""
        if not spec.rag_enabled or retriever is None:
            return {}

        agent = spec.agent(state.get("route_selected"))
        if agent is None:
            return {}

        try:
            hits = await retriever(agent.id, state.get("user_input", ""), spec.rag_top_k)
        except Exception as exc:  # noqa: BLE001 - 检索失败不应中断主流程
            emit({"type": "status", "status": "rag_failed", "detail": str(exc)[:200]})
            return {}

        if not hits:
            return {}

        # 编号化拼接，方便模型在回答中引用 [1][2]
        context = "\n\n".join(
            f"[{idx + 1}] {hit.get('content', '')}" for idx, hit in enumerate(hits)
        )
        emit({"type": "rag", "hits": len(hits)})
        return {
            "rag_context": context,
            "rag_sources": [
                {
                    "index": idx + 1,
                    "document_id": str(hit.get("document_id", "")),
                    "title": hit.get("title") or "",
                    "score": round(float(hit.get("score", 0.0)), 4),
                }
                for idx, hit in enumerate(hits)
            ],
        }

    async def run_agent(state: AgentState) -> AgentState:
        """执行选中的 Agent，并在执行期间接上流式发射器。"""
        agent = spec.agent(state.get("route_selected"))
        if agent is None:
            return {"degraded": True, "guard_reason": "路由未命中可执行 Agent"}

        token = set_emitter(emitter) if emitter is not None else None
        try:
            result = await runner(agent, state)
        finally:
            if token is not None:
                reset_emitter(token)

        return {
            "current_agent": agent.id,
            "draft_output": result.reply,
            "token_usage": result.tokens,
            "last_outputs": [result.reply],
            "hidden_responses": result.hidden,
        }

    async def guard(state: AgentState) -> AgentState:
        """输出校验：空输出、过短输出、连续重复都判为不合格。"""
        passed, reason = guards.guard_output(state.get("draft_output"))
        if passed and guards.is_stalled(state.get("last_outputs", [])):
            passed, reason = False, "检测到连续无进展（疑似死循环）"
        return {"guard_passed": passed, "guard_reason": reason}

    async def fallback(state: AgentState) -> AgentState:
        """降级分支：用兜底 Agent 再试一次，仍失败则以 FAILED 收尾。"""
        agent = spec.fallback_agent
        if agent is None:
            return {"degraded": True, "draft_output": None}
        token = set_emitter(emitter) if emitter is not None else None
        try:
            result = await runner(agent, state)
        except Exception:  # noqa: BLE001 - 兜底再失败即放弃，交由 finalize 判 FAILED
            return {"degraded": True, "draft_output": None}
        finally:
            if token is not None:
                reset_emitter(token)

        return {
            "degraded": True,
            "draft_output": result.reply,
            "current_agent": agent.id,
            "token_usage": result.tokens,
            "hidden_responses": result.hidden,
        }

    async def finalize(state: AgentState) -> AgentState:
        """唯一出口：把状态归一成终态。"""
        if state.get("terminal_status") in TaskStatus.TERMINAL:
            return {}
        if state.get("degraded"):
            status = TaskStatus.DEGRADED if state.get("draft_output") else TaskStatus.FAILED
        elif state.get("guard_passed") and state.get("draft_output"):
            status = TaskStatus.COMPLETED
        else:
            status = TaskStatus.FAILED
        return {"terminal_status": status}

    # ------------------------------------------------------------------ 条件边
    def after_prepare(state: AgentState) -> str:
        return "finalize" if state.get("terminal_status") == TaskStatus.FAILED else "route"

    def after_route(state: AgentState) -> str:
        return "rag" if state.get("route_selected") else "fallback"

    def after_guard(state: AgentState) -> str:
        return "finalize" if state.get("guard_passed") else "fallback"

    # ------------------------------------------------------------------ 装配
    graph = StateGraph(AgentState)
    graph.add_node("prepare", prepare)
    graph.add_node("route", route)
    graph.add_node("rag", rag)
    graph.add_node("agent", run_agent)
    graph.add_node("guard", guard)
    graph.add_node("fallback", fallback)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "prepare")
    graph.add_conditional_edges(
        "prepare", after_prepare, {"route": "route", "finalize": "finalize"}
    )
    graph.add_conditional_edges(
        "route", after_route, {"rag": "rag", "fallback": "fallback"}
    )
    graph.add_edge("rag", "agent")
    graph.add_edge("agent", "guard")
    graph.add_conditional_edges(
        "guard", after_guard, {"finalize": "finalize", "fallback": "fallback"}
    )
    graph.add_edge("fallback", "finalize")
    graph.add_edge("finalize", END)

    return graph.compile()
