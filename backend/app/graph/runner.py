"""图执行入口：超时保护 + 异常收敛，保证「结束态必达」（PRD FR-R-01）。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from app.core.config import get_settings
from app.graph.builder import AgentRunner, build_graph
from app.graph.routing.base import LLMClassifier
from app.graph.spec import WorkflowSpec
from app.graph.state import AgentState, initial_state
from app.models import TaskStatus


@dataclass
class RunResult:
    status: str
    reply: str | None = None
    hidden: list[dict] = field(default_factory=list)
    token_usage: int = 0
    degraded: bool = False
    reason: str = ""
    route: dict = field(default_factory=dict)

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
    max_iterations: int | None = None,
    timeout_ms: int | None = None,
) -> RunResult:
    settings = get_settings()
    limit = max_iterations or spec.max_iterations or settings.max_iterations
    timeout = (timeout_ms or settings.task_timeout_ms) / 1000

    graph = build_graph(spec, runner=runner, classifier=classifier, max_iterations=limit)
    state = initial_state(
        tenant_id=tenant_id,
        application_id=application_id,
        conversation_id=conversation_id,
        user_id=user_id,
        run_id=run_id,
        user_input=user_input,
    )

    try:
        final: AgentState = await asyncio.wait_for(
            graph.ainvoke(state, config={"recursion_limit": limit + 5}),
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
    )
