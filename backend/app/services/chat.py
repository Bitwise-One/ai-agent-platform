"""对话编排：串起 会话 → 任务 → LangGraph → 消息 的完整链路。

两条路径共用同一套准备/收尾逻辑：
- `chat()`        非流式：一次跑完，返回完整结果；
- `stream_chat()` 流式：先发 meta，再边执行边把事件推给 SSE，最后发 done。

落库顺序遵循「任务先创建、后收敛终态」，保证异常也有终态可查（FR-R-01）。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import RequestContext
from app.core.errors import NotFound
from app.graph.builder import AgentRunner, EventEmitter, RagRetriever
from app.graph.runner import RunResult, run_workflow
from app.graph.runners.llm import llm_agent_runner
from app.graph.spec import WorkflowSpec
from app.knowledge import service as kb_service
from app.models import (
    Agent,
    AgentSkill,
    Application,
    Conversation,
    HiddenResponse,
    Skill,
    TaskRun,
    TaskStatus,
    Workflow,
)
from app.schemas.conversation import ChatRequest, ChatResponse, ConversationCreate
from app.services import agents as agent_service
from app.services import conversations as conv_service
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
    model_names = await model_service.resolve_model_names(session, tenant_id, model_ids)
    return WorkflowSpec.from_db(db_agents, definition, model_names=model_names)


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
        session, ctx.tenant_id, conversation.id, {"message": payload.message}
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
    return PreparedChat(
        conversation=conversation,
        run=run,
        spec=spec,
        retriever=_make_retriever(session, ctx.tenant_id),
        runner=runner or llm_agent_runner,
        skills_by_agent=skills_by_agent,
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
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("工作流调度异常")
        return RunResult(status=TaskStatus.FAILED, reason=f"调度异常: {exc}")


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
            record = HiddenResponse(
                tenant_id=ctx.tenant_id,
                message_id=msg.id,
                run_id=prepared.run.id,
                action=str(item.get("action", "custom")),
                payload=item.get("payload") or {},
            )
            session.add(record)
            hidden_out.append({"action": record.action, "payload": record.payload})
        await session.flush()

    return ChatResponse(
        conversation_id=prepared.conversation.id,
        run_id=prepared.run.id,
        status=result.status,
        reply=result.reply,
        hidden_responses=hidden_out,
        token_usage=result.token_usage,
        rag_sources=result.rag_sources,
    )


# ---------------------------------------------------------------- 非流式
async def chat(
    session: AsyncSession,
    ctx: RequestContext,
    app_id: uuid.UUID,
    payload: ChatRequest,
    *,
    runner: AgentRunner | None = None,
) -> ChatResponse:
    prepared = await prepare_chat(session, ctx, app_id, payload, runner=runner)
    result = await _execute(prepared, ctx, app_id, payload)
    return await _finalize(session, ctx, prepared, result)


# ---------------------------------------------------------------- 流式
async def stream_chat(
    session: AsyncSession,
    ctx: RequestContext,
    app_id: uuid.UUID,
    payload: ChatRequest,
    *,
    runner: AgentRunner | None = None,
) -> AsyncIterator[dict]:
    """产出事件流（由接口层转成 SSE 文本）。

    事件顺序：meta → (status/route/rag/token)* → hidden* → done
    即使执行抛错，也会发 done，保证前端不会永久等待。
    """
    prepared = await prepare_chat(session, ctx, app_id, payload, runner=runner)

    yield {
        "type": "meta",
        "run_id": str(prepared.run.id),
        "conversation_id": str(prepared.conversation.id),
        "application_id": str(app_id),
    }

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
        yield event

    try:
        result = await task
    except Exception as exc:  # noqa: BLE001
        logger.exception("流式执行异常")
        result = RunResult(status=TaskStatus.FAILED, reason=f"执行异常: {exc}")

    response = await _finalize(session, ctx, prepared, result)

    # 流式路径下 token 已经实时推过，这里只补发隐藏返回与终态
    for item in response.hidden_responses:
        yield {"type": "hidden", **item}

    yield {
        "type": "done",
        "status": response.status,
        "run_id": str(response.run_id),
        "token_usage": response.token_usage,
        "rag_sources": response.rag_sources,
        "reason": result.reason,
    }
