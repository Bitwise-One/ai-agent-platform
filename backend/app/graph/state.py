"""LangGraph 统一状态定义（对应 design/langgraph.md §1）。

Reducer 约定：
- messages        追加（不覆盖）
- parallel_results 深度合并（并行 Agent 各写自己的 key）
- iteration_count 累加
- 其余标量        覆盖（单一写入者）
"""

from typing import Annotated, Any, TypedDict

Message = dict[str, Any]


def merge_messages(left: list[Message] | None, right: list[Message] | None) -> list[Message]:
    return (left or []) + (right or [])


def merge_parallel(left: dict[str, Any] | None, right: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(left or {})
    merged.update(right or {})
    return merged


def inc_iteration(left: int | None, right: int | None) -> int:
    return (left or 0) + (right or 0)


class AgentState(TypedDict, total=False):
    # ---- 请求上下文（入口注入，只读）----
    tenant_id: str
    application_id: str
    conversation_id: str
    user_id: str
    run_id: str
    workflow_version_id: str

    # ---- 消息与输入 ----
    messages: Annotated[list[Message], merge_messages]
    user_input: str

    # ---- 路由 ----
    route_strategy: str
    route_selected: str | None
    route_confidence: float
    route_reason: str
    route_candidates: list[dict[str, Any]]

    # ---- 执行 ----
    current_agent: str | None
    iteration_count: Annotated[int, inc_iteration]
    last_outputs: Annotated[list[str], merge_messages]
    parallel_results: Annotated[dict[str, Any], merge_parallel]
    draft_output: str | None

    # ---- RAG（M2）：检索到的上下文与引用来源 ----
    rag_context: str
    rag_sources: Annotated[list[dict[str, Any]], merge_messages]

    # ---- 校验与终态 ----
    guard_passed: bool | None
    guard_reason: str
    degraded: bool
    terminal_status: str

    # ---- 隐藏返回（不进聊天框）----
    hidden_responses: Annotated[list[dict[str, Any]], merge_messages]

    # Bound instruction Skills loaded within tenant + application scope.
    skills_by_agent: dict[str, list[dict[str, Any]]]

    # ---- 计量 ----
    token_usage: int


def initial_state(
    *,
    tenant_id: str,
    application_id: str,
    conversation_id: str,
    user_id: str,
    run_id: str,
    user_input: str,
    skills_by_agent: dict[str, list[dict[str, Any]]] | None = None,
) -> AgentState:
    return AgentState(
        tenant_id=tenant_id,
        application_id=application_id,
        conversation_id=conversation_id,
        user_id=user_id,
        run_id=run_id,
        user_input=user_input,
        skills_by_agent=skills_by_agent or {},
        messages=[{"role": "user", "content": user_input}],
        iteration_count=1,
        token_usage=0,
    )
