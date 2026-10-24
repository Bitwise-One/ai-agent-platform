"""图执行入口：超时保护 + 异常收敛，保证「结束态必达」（PRD FR-R-01）。

设计要点：
1. `asyncio.wait_for` 兜住整图耗时，超时后返回 TIMED_OUT 而不是让请求挂着；
2. 任何未捕获异常都转成 FAILED，并带上可读原因；
3. 无论走哪条分支，返回的 RunResult 一定带一个合法终态。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from app.core.config import get_settings
from app.graph.builder import AgentRunner, EventEmitter, RagRetriever, build_graph
from app.graph.routing.base import LLMClassifier
from app.graph.spec import WorkflowSpec
from app.graph.state import AgentState, initial_state
from app.models import TaskStatus


@dataclass
class RunResult:
    """一次图执行的最终结果。"""

    status: str
    reply: str | None = None
    hidden: list[dict] = field(default_factory=list)
    token_usage: int = 0
    degraded: bool = False
    reason: str = ""
    route: dict = field(default_factory=dict)
    rag_sources: list[dict] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == TaskStatus.COMPLETED


async def run_workflow(
    spec: WorkflowSpec,
    *,
    tenant_id: str,
    application_id: str,
    conversation_id: str,
    user_id: str,
    run_id: str,
    user_input: str,
    runner: AgentRunner | None = None,
    classifier: LLMClassifier | None = None,
    retriever: RagRetriever | None = None,
    emitter: EventEmitter | None = None,
    max_iterations: int | None = None,
    timeout_ms: int | None = None,
) -> RunResult:
    """执行一次工作流。

    Args:
        spec: 工作流规格。
        tenant_id/application_id/conversation_id/user_id/run_id: 四层隔离上下文。
        user_input: 用户输入。
        runner: Agent 执行器（默认模板回显）。
        classifier: 语义路由分类器。
        retriever: 知识库检索器。
        emitter: 流式事件发射器（SSE 场景传入）。
        max_iterations: 最大轮次。
        timeout_ms: 整图超时（毫秒）。
    """
    settings = get_settings()
    limit = max_iterations or spec.max_iterations or settings.max_iterations
    timeout = (timeout_ms or settings.task_timeout_ms) / 1000

    graph = build_graph(
        spec,
        runner=runner,
        classifier=classifier,
        retriever=retriever,
        emitter=emitter,
        max_iterations=limit,
    )
    state = initial_state(
        tenant_id=tenant_id,
        application_id=application_id,
        conversation_id=conversation_id,
        user_id=user_id,
        run_id=run_id,
        user_input=user_input,
    )

    try:
        # recursion_limit 比业务轮次略大，留出 prepare/route/guard 等控制节点的开销
        final: AgentState = await asyncio.wait_for(
            graph.ainvoke(state, config={"recursion_limit": limit * 2 + 10}),
            timeout=timeout,
        )
    except TimeoutError:
        return RunResult(
            status=TaskStatus.TIMED_OUT,
            reason=f"执行超时（{timeout:.1f}s）",
            degraded=True,
        )
    except Exception as exc:  # noqa: BLE001 - 兜底：任何异常都必须收敛为终态
        return RunResult(
            status=TaskStatus.FAILED,
            reason=f"执行异常: {exc.__class__.__name__}: {exc}",
        )

    status = final.get("terminal_status") or TaskStatus.FAILED
    return RunResult(
        status=status,
        reply=final.get("draft_output"),
        hidden=list(final.get("hidden_responses") or []),
        token_usage=int(final.get("token_usage") or 0),
        degraded=bool(final.get("degraded")),
        reason=final.get("guard_reason") or final.get("route_reason") or "",
        route={
            "strategy": final.get("route_strategy"),
            "selected": final.get("route_selected"),
            "confidence": final.get("route_confidence"),
            "reason": final.get("route_reason"),
            "candidates": final.get("route_candidates") or [],
        },
        rag_sources=list(final.get("rag_sources") or []),
    )
