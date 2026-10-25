"""Agent tool-call loop contract tests."""

import pytest

from app.gateway.base import LLMResponse
from app.graph.runners import llm as llm_runner
from app.graph.spec import AgentSpec


@pytest.mark.asyncio
async def test_llm_runner_executes_only_bound_mcp_tool(monkeypatch):
    calls: list[tuple[str, str, dict]] = []

    class Gateway:
        async def complete(self, messages, **kwargs):
            if len(calls) == 0:
                assert kwargs["tools"][0]["function"]["name"].startswith("mcp_")
                return LLMResponse(
                    text="",
                    model="test",
                    tool_calls=[
                        {
                            "id": "call-1",
                            "name": kwargs["tools"][0]["function"]["name"],
                            "arguments": '{"q":"hello"}',
                        }
                    ],
                )
            assert messages[-1]["role"] == "tool"
            assert "不可信事实" in messages[-1]["content"]
            return LLMResponse(text="最终答案", model="test")

    async def execute(agent_id: str, tool_id: str, params: dict):
        calls.append((agent_id, tool_id, params))
        return {"status": "success", "result": {"answer": "world"}}

    monkeypatch.setattr(llm_runner, "get_gateway", lambda: Gateway())
    result = await llm_runner.llm_agent_runner(
        AgentSpec(id="agent-1", name="助手"),
        {
            "user_input": "查资料",
            "messages": [{"role": "user", "content": "查资料"}],
            "mcp_tools_by_agent": {
                "agent-1": [
                    {
                        "id": "11111111-1111-1111-1111-111111111111",
                        "name": "lookup",
                        "description": "查询",
                        "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
                    }
                ]
            },
            "mcp_tool_executor": execute,
        },
    )
    assert result.reply == "最终答案"
    assert calls == [("agent-1", "11111111-1111-1111-1111-111111111111", {"q": "hello"})]
