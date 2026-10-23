"""兜底与终态单测：结束态必达、空输入、超时、异常收敛。"""

import pytest

from app.graph.runner import run_workflow
from app.graph.spec import AgentSpec, WorkflowSpec
from app.models import TaskStatus


def spec() -> WorkflowSpec:
    return WorkflowSpec(
        agents=[AgentSpec(id="default", name="默认助手", is_default=True)],
        router="rule",
        default_agent="default",
    )


BASE = {
    "tenant_id": "t1",
    "application_id": "a1",
    "conversation_id": "c1",
    "user_id": "u1",
    "run_id": "r1",
}


@pytest.mark.asyncio
async def test_normal_run_completes():
    result = await run_workflow(spec(), user_input="你好", **BASE)
    assert result.status == TaskStatus.COMPLETED
    assert result.reply


@pytest.mark.asyncio
async def test_empty_input_ends_in_terminal_state():
    result = await run_workflow(spec(), user_input="   ", **BASE)
    assert result.status == TaskStatus.FAILED
    assert result.status in TaskStatus.TERMINAL


@pytest.mark.asyncio
async def test_timeout_yields_timed_out():
    from app.graph.builder import AgentResult

    async def slow_runner(agent, state):
        import asyncio

        await asyncio.sleep(0.5)
        return AgentResult(reply="ok")

    result = await run_workflow(
        spec(), user_input="慢任务", runner=slow_runner, timeout_ms=50, **BASE
    )
    assert result.status == TaskStatus.TIMED_OUT


@pytest.mark.asyncio
async def test_runner_exception_converges_to_failed():

    async def boom(agent, state):
        raise RuntimeError("tool exploded")

    # 异常先由 guard 判空走 fallback，fallback 再次抛错 → 收敛为 FAILED
    result = await run_workflow(spec(), user_input="触发异常", runner=boom, **BASE)
    assert result.status in {TaskStatus.FAILED, TaskStatus.DEGRADED}


@pytest.mark.asyncio
async def test_route_decision_is_exposed():
    wf = WorkflowSpec(
        agents=[
            AgentSpec(id="contract", name="合同助手", keywords=["合同"]),
            AgentSpec(id="default", name="默认助手", is_default=True),
        ],
        router="rule",
        default_agent="default",
    )
    result = await run_workflow(wf, user_input="审一下合同", **BASE)
    assert result.route["selected"] == "contract"
    assert result.route["strategy"] == "rule"
