"""对话编排：串起 会话 → 任务 → LangGraph → 消息 的完整链路。

两条路径共用同一套准备/收尾逻辑：
- `chat()`        非流式：一次跑完，返回完整结果；
- `stream_chat()` 流式：先发 meta，再边执行边把事件推给 SSE，最后发 done。

落库顺序遵循「任务先创建、后收敛终态」，保证异常也有终态可查（FR-R-01）。
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import set_tenant_context
from app.core.deps import RequestContext
from app.core.errors import AppError, NotFound
from app.core.security import TokenError, issue_hidden_action_token, verify_hidden_action_token
from app.graph.builder import AgentRunner, EventEmitter, RagRetriever
from app.graph.runner import RunResult, run_workflow
from app.graph.runners.llm import llm_agent_runner
from app.graph.spec import WorkflowSpec
from app.knowledge import service as kb_service
from app.models import (
    Agent,
    AgentMcpTool,
    AgentSkill,
    Application,
    Conversation,
    HiddenResponse,
    McpToolRecord,
    RunStreamEvent,
    Skill,
    TaskRun,
    TaskStatus,
    Workflow,
)
from app.models.base import utcnow
from app.schemas.conversation import ChatRequest, ChatResponse, ConversationCreate
from app.schemas.integration import McpToolCallRequest
from app.services import agents as agent_service
from app.services import conversations as conv_service
from app.services import integrations as integration_service
from app.services import models as model_service
from app.services.tenants import ensure_tenant_matches

logger = logging.getLogger(__name__)


@dataclass
class PreparedChat:
    """流式与非流式共用的执行前状态。"""

    conversation: Conversation
    run: TaskRun
    spec: WorkflowSpec
    retriever: RagRetriever | None
    runner: AgentRunner
    skills_by_agent: dict[str, list[dict]]
    mcp_tools_by_agent: dict[str, list[dict]]
    mcp_tool_executor: Any
    replay_events: list[dict] | None = None


def _response_for_existing_run(prepared: PreparedChat) -> ChatResponse:
    output = prepared.run.output or {}
    return ChatResponse(
        conversation_id=prepared.conversation.id,
        run_id=prepared.run.id,
        status=prepared.run.status,
        reply=output.get("reply"),
        hidden_responses=output.get("hidden_responses") or [],
        token_usage=prepared.run.token_usage,
        rag_sources=output.get("rag_sources") or [],
    )


# ---------------------------------------------------------------- 准备阶段
async def _load_spec(
    session: AsyncSession, tenant_id: uuid.UUID, app: Application
) -> WorkflowSpec:
    """组装工作流规格：Agent 取自数据库，拓扑取自工作流图定义。

    模型名在这里一次解析完：Agent 表只存 model_config_id（租户可改），
    真正发给厂商的是 model_name。预取成字典后传给 `from_db`，
    避免图执行期间再去查库（图节点不应持有数据库会话）。
    """
    definition: dict = {}
    if app.default_workflow_id:
        workflow = await session.get(Workflow, app.default_workflow_id)
        if workflow is not None and workflow.graph_definition:
            definition = workflow.graph_definition

    db_agents = await agent_service.list_agents(session, tenant_id, app.id)
    if not db_agents:
        return WorkflowSpec.from_definition(definition)

    model_ids = [a.model_config_id for a in db_agents if a.model_config_id]
    model_runtime = await model_service.resolve_model_runtime(session, tenant_id, model_ids)
    return WorkflowSpec.from_db(db_agents, definition, model_runtime=model_runtime)


def _make_retriever(session: AsyncSession, tenant_id: uuid.UUID) -> RagRetriever:
    """构造知识库检索器。

    检索器在 Agent 执行前被图节点调用，因此需要能按 agent_id 找到它绑定的知识库。
    `tenant_id` 在此闭包捕获，保证检索永远限定在本租户范围内（FR-K-07）。
    """

    async def _retrieve(agent_id: str, query: str, top_k: int) -> list[dict]:
        try:
            aid = uuid.UUID(agent_id)
        except (ValueError, TypeError):
            return []
        kb_ids = await agent_service.get_kb_ids(session, aid)
        if not kb_ids:
            return []
        return await kb_service.search(session, tenant_id, kb_ids, query, top_k=top_k)

    return _retrieve


async def prepare_chat(
    session: AsyncSession,
    ctx: RequestContext,
    app_id: uuid.UUID,
    payload: ChatRequest,
    idempotency_key: str | None = None,
    *,
    runner: AgentRunner | None = None,
) -> PreparedChat:
    """校验租户/应用 → 取或建会话 → 落用户消息 → 建任务（created→running）。"""
    await ensure_tenant_matches(session, ctx.tenant_id)

    app = await session.scalar(
        select(Application).where(
            Application.id == app_id,
            Application.tenant_id == ctx.tenant_id,
            Application.deleted_at.is_(None),
        )
    )
    if app is None:
        raise NotFound("应用不存在")

    request_hash = hashlib.sha256(
        json.dumps(
            {"user_id": payload.user_id, "conversation_id": str(payload.conversation_id) if payload.conversation_id else None, "message": payload.message},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    if idempotency_key:
        if len(idempotency_key) > 128 or not idempotency_key.strip():
            raise AppError(10001, "Idempotency-Key 必须为 1 到 128 个非空字符", 422)
        existing = await session.scalar(
            select(TaskRun).where(
                TaskRun.tenant_id == ctx.tenant_id,
                TaskRun.application_id == app_id,
                TaskRun.idempotency_key == idempotency_key,
            )
        )
        if existing:
            if existing.request_hash != request_hash:
                raise AppError(10009, "Idempotency-Key 已用于不同请求", 409)
            conversation = await conv_service.get_conversation(
                session, ctx.tenant_id, app_id, existing.conversation_id, user_id=payload.user_id
            )
            events = await session.scalars(
                select(RunStreamEvent)
                .where(RunStreamEvent.run_id == existing.id, RunStreamEvent.tenant_id == ctx.tenant_id)
                .order_by(RunStreamEvent.sequence)
            )
            return PreparedChat(
                conversation=conversation,
                run=existing,
                spec=WorkflowSpec.from_definition({}),
                retriever=None,
                runner=runner or llm_agent_runner,
                skills_by_agent={},
                mcp_tools_by_agent={},
                mcp_tool_executor=None,
                replay_events=[event.data for event in events],
            )

    if payload.conversation_id:
        conversation = await conv_service.get_conversation(
            session, ctx.tenant_id, app_id, payload.conversation_id, user_id=payload.user_id
        )
    else:
        conversation = await conv_service.create_conversation(
            session,
            ctx.tenant_id,
            app_id,
            ConversationCreate(user_id=payload.user_id, metadata=payload.metadata),
        )

    await conv_service.append_message(
        session, ctx.tenant_id, conversation.id, "user", payload.message
    )

    run = await conv_service.create_run(
        session,
        ctx.tenant_id,
        app_id,
        conversation.id,
        {"message": payload.message},
        idempotency_key=idempotency_key,
        request_hash=request_hash if idempotency_key else None,
    )
    await conv_service.start_run(session, run)

    spec = await _load_spec(session, ctx.tenant_id, app)
    skill_rows = await session.execute(
        select(AgentSkill.agent_id, Skill.name, Skill.instructions, Skill.trigger)
        .join(Skill, Skill.id == AgentSkill.skill_id)
        .join(Agent, Agent.id == AgentSkill.agent_id)
        .where(
            Agent.tenant_id == ctx.tenant_id,
            Agent.application_id == app.id,
            Agent.deleted_at.is_(None),
            Skill.tenant_id == ctx.tenant_id,
            Skill.instructions.is_not(None),
        )
    )
    skills_by_agent: dict[str, list[dict]] = {}
    for agent_id, name, instructions, trigger in skill_rows:
        skills_by_agent.setdefault(str(agent_id), []).append(
            {"name": name, "instructions": instructions, "trigger": trigger or {}}
        )
    mcp_rows = await session.execute(
        select(AgentMcpTool.agent_id, McpToolRecord.id, McpToolRecord.name, McpToolRecord.description, McpToolRecord.input_schema)
        .join(McpToolRecord, McpToolRecord.id == AgentMcpTool.tool_id)
        .join(Agent, Agent.id == AgentMcpTool.agent_id)
        .where(
            Agent.tenant_id == ctx.tenant_id,
            Agent.application_id == app.id,
            Agent.deleted_at.is_(None),
            McpToolRecord.tenant_id == ctx.tenant_id,
            McpToolRecord.enabled.is_(True),
        )
    )
    mcp_tools_by_agent: dict[str, list[dict]] = {}
    for agent_id, tool_id, name, description, input_schema in mcp_rows:
        mcp_tools_by_agent.setdefault(str(agent_id), []).append(
            {"id": str(tool_id), "name": name, "description": description or "", "input_schema": input_schema or {}}
        )

    async def execute_mcp_tool(agent_id: str, tool_id: str, params: dict) -> dict:
        try:
            aid = uuid.UUID(agent_id)
            tid = uuid.UUID(tool_id)
        except (ValueError, TypeError) as exc:
            raise NotFound("MCP 工具不存在或未绑定") from exc
        return await integration_service.call_agent_mcp_tool(
            session, ctx.tenant_id, app.id, aid, tid,
            McpToolCallRequest(params=params), ctx.request_id,
        )

    async def execute_bound_mcp_tool(agent_id: str, tool_id: str, params: dict) -> dict:
        return await execute_mcp_tool(agent_id, tool_id, params)

    return PreparedChat(
        conversation=conversation,
        run=run,
        spec=spec,
        retriever=_make_retriever(session, ctx.tenant_id),
        runner=runner or llm_agent_runner,
        skills_by_agent=skills_by_agent,
        mcp_tools_by_agent=mcp_tools_by_agent,
        mcp_tool_executor=execute_bound_mcp_tool,
    )


async def _execute(
    prepared: PreparedChat,
    ctx: RequestContext,
    app_id: uuid.UUID,
    payload: ChatRequest,
    *,
    emitter: EventEmitter | None = None,
) -> RunResult:
    """执行图，并兜住任何异常，保证返回 RunResult（结束态必达）。"""
    try:
        return await run_workflow(
            prepared.spec,
            tenant_id=str(ctx.tenant_id),
            application_id=str(app_id),
            conversation_id=str(prepared.conversation.id),
            user_id=payload.user_id,
            run_id=str(prepared.run.id),
            user_input=payload.message,
            runner=prepared.runner,
            retriever=prepared.retriever,
            emitter=emitter,
            skills_by_agent=prepared.skills_by_agent,
            mcp_tools_by_agent=prepared.mcp_tools_by_agent,
            mcp_tool_executor=prepared.mcp_tool_executor,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("工作流调度异常")
        return RunResult(status=TaskStatus.FAILED, reason=f"调度异常: {exc}")


async def _persist_stream_event(
    session: AsyncSession, tenant_id: uuid.UUID, run_id: uuid.UUID, sequence: int, event: dict
) -> None:
    session.add(
        RunStreamEvent(
            tenant_id=tenant_id,
            run_id=run_id,
            sequence=sequence,
            event_type=event["type"],
            data=event,
        )
    )
    await session.commit()
    await set_tenant_context(session, str(tenant_id))


async def _load_stream_events(
    session: AsyncSession, tenant_id: uuid.UUID, run_id: uuid.UUID, after: int = 0
) -> list[dict]:
    rows = await session.scalars(
        select(RunStreamEvent)
        .where(
            RunStreamEvent.tenant_id == tenant_id,
            RunStreamEvent.run_id == run_id,
            RunStreamEvent.sequence > after,
        )
        .order_by(RunStreamEvent.sequence)
    )
    return [row.data for row in rows]


# ---------------------------------------------------------------- 收尾阶段
async def _finalize(
    session: AsyncSession, ctx: RequestContext, prepared: PreparedChat, result: RunResult
) -> ChatResponse:
    """收敛终态 → 落助手消息 → 落隐藏返回。"""
    await conv_service.finish_run(
        session,
        prepared.run,
        status=result.status,
        output={
            "reply": result.reply,
            "route": result.route,
            "reason": result.reason,
            "rag_sources": result.rag_sources,
        },
        token_usage=result.token_usage,
    )

    hidden_out: list[dict] = []
    if result.reply:
        msg = await conv_service.append_message(
            session, ctx.tenant_id, prepared.conversation.id, "assistant", result.reply
        )
        for item in result.hidden:
            if item.get("action") in {"call_function", "download_file"}:
                logger.warning("high-risk hidden action rejected until an operation registry is configured: %s", item.get("action"))
                continue
            record = HiddenResponse(
                tenant_id=ctx.tenant_id,
                message_id=msg.id,
                run_id=prepared.run.id,
                action=str(item.get("action", "custom")),
                payload=item.get("payload") or {},
                created_at=utcnow(),
            )
            session.add(record)
            await session.flush()
            payload_hash = hashlib.sha256(
                json.dumps(record.payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
            token = issue_hidden_action_token(
                response_id=str(record.id),
                tenant_id=str(ctx.tenant_id),
                application_id=str(prepared.conversation.application_id),
                conversation_id=str(prepared.conversation.id),
                run_id=str(prepared.run.id),
                action=record.action,
                payload_hash=payload_hash,
            )
            hidden_out.append({
                "type": "hidden",
                "channel": "system",
                "event": "ui_action",
                "action": record.action,
                "payload": record.payload,
                "meta": {
                    "request_id": ctx.request_id,
                    "agent_id": result.route.get("selected"),
                    "timestamp": int(record.created_at.timestamp()),
                    "capability": {"action": record.action, "scope": "conversation"},
                    "action_token": token,
                },
            })
    output = dict(prepared.run.output or {})
    output["hidden_responses"] = hidden_out
    prepared.run.output = output
    return ChatResponse(
        conversation_id=prepared.conversation.id,
        run_id=prepared.run.id,
        status=result.status,
        reply=result.reply,
        hidden_responses=hidden_out,
        token_usage=result.token_usage,
        rag_sources=result.rag_sources,
    )


async def consume_hidden_action(
    session: AsyncSession,
    ctx: RequestContext,
    app_id: uuid.UUID,
    token: str,
) -> dict:
    try:
        claims = verify_hidden_action_token(token)
        response_id = uuid.UUID(claims["rid"])
        conversation_id = uuid.UUID(claims["cid"])
        run_id = uuid.UUID(claims["run"])
    except (TokenError, KeyError, ValueError) as exc:
        raise AppError(10003, "隐藏动作 token 无效或已过期", 401) from exc
    if claims.get("tid") != str(ctx.tenant_id) or claims.get("aid") != str(app_id):
        raise NotFound("隐藏动作不存在")
    from sqlalchemy import update

    from app.models import Conversation

    row = await session.scalar(
        select(HiddenResponse)
        .join(Conversation, Conversation.id == conversation_id)
        .where(
            HiddenResponse.id == response_id,
            HiddenResponse.tenant_id == ctx.tenant_id,
            HiddenResponse.run_id == run_id,
            HiddenResponse.action == claims.get("act"),
            Conversation.application_id == app_id,
            Conversation.tenant_id == ctx.tenant_id,
            Conversation.user_id == ctx.user_id,
            HiddenResponse.consumed_at.is_(None),
        )
        .with_for_update()
    )
    if row is None:
        raise NotFound("隐藏动作不存在、已消费或不属于当前用户")
    digest = hashlib.sha256(
        json.dumps(row.payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if not hmac.compare_digest(digest, claims.get("ph", "")):
        raise AppError(10003, "隐藏动作内容校验失败", 401)
    result = await session.execute(
        update(HiddenResponse)
        .where(HiddenResponse.id == response_id, HiddenResponse.consumed_at.is_(None))
        .values(consumed_at=utcnow())
    )
    if result.rowcount != 1:
        raise NotFound("隐藏动作不存在或已消费")
    return {"action": row.action, "payload": row.payload, "consumed": True}


# ---------------------------------------------------------------- 非流式
async def chat(
    session: AsyncSession,
    ctx: RequestContext,
    app_id: uuid.UUID,
    payload: ChatRequest,
    *,
    idempotency_key: str | None = None,
    runner: AgentRunner | None = None,
) -> ChatResponse:
    prepared = await prepare_chat(session, ctx, app_id, payload, runner=runner, idempotency_key=idempotency_key)
    if prepared.replay_events is not None:
        return _response_for_existing_run(prepared)
    result = await _execute(prepared, ctx, app_id, payload)
    return await _finalize(session, ctx, prepared, result)


# ---------------------------------------------------------------- 流式
async def stream_chat(
    session: AsyncSession,
    ctx: RequestContext,
    app_id: uuid.UUID,
    payload: ChatRequest,
    *,
    idempotency_key: str | None = None,
    runner: AgentRunner | None = None,
) -> AsyncIterator[dict]:
    """产出事件流（由接口层转成 SSE 文本）。

    事件顺序：meta → (status/route/rag/token)* → hidden* → done
    即使执行抛错，也会发 done，保证前端不会永久等待。
    """
    prepared = await prepare_chat(session, ctx, app_id, payload, runner=runner, idempotency_key=idempotency_key)
    if prepared.replay_events is not None:
        last_sequence = 0
        for event in prepared.replay_events:
            last_sequence = max(last_sequence, int(event.get("id", 0)))
            yield event
        if prepared.run.status not in TaskStatus.TERMINAL:
            deadline = asyncio.get_running_loop().time() + get_settings().task_timeout_ms / 1000
            while prepared.run.status not in TaskStatus.TERMINAL and asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(0.1)
                for event in await _load_stream_events(session, ctx.tenant_id, prepared.run.id, last_sequence):
                    last_sequence = max(last_sequence, int(event.get("id", 0)))
                    yield event
                await session.refresh(prepared.run)
        return

    await session.commit()
    await set_tenant_context(session, str(ctx.tenant_id))
    sequence = 0

    async def _durable(event: dict) -> dict:
        nonlocal sequence
        sequence += 1
        stored = {**event, "id": sequence, "run_id": str(prepared.run.id)}
        await _persist_stream_event(session, ctx.tenant_id, prepared.run.id, sequence, stored)
        return stored

    yield await _durable({
        "type": "meta",
        "conversation_id": str(prepared.conversation.id),
        "application_id": str(app_id),
    })

    queue: asyncio.Queue[dict] = asyncio.Queue()

    def emitter(event: dict) -> None:
        # 发射器必须是同步函数（在图节点内被调用），这里只做入队
        queue.put_nowait(event)

    task = asyncio.create_task(
        _execute(prepared, ctx, app_id, payload, emitter=emitter), name="chat-exec"
    )

    # 边执行边消费队列；task 结束后把剩余事件排空
    while True:
        if task.done() and queue.empty():
            break
        try:
            event = await asyncio.wait_for(queue.get(), timeout=0.05)
        except TimeoutError:
            continue
        yield await _durable(event)

    try:
        result = await task
    except Exception as exc:  # noqa: BLE001
        logger.exception("流式执行异常")
        result = RunResult(status=TaskStatus.FAILED, reason=f"执行异常: {exc}")

    response = await _finalize(session, ctx, prepared, result)

    # 流式路径下 token 已经实时推过，这里只补发隐藏返回与终态
    for item in response.hidden_responses:
        yield await _durable({**item, "type": "hidden"})

    yield await _durable({
        "type": "done",
        "status": response.status,
        "token_usage": response.token_usage,
        "rag_sources": response.rag_sources,
        "reason": result.reason,
    })
