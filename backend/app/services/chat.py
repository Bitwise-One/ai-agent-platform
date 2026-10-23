"""对话编排：串起 会话 → 任务 → LangGraph → 消息 的完整链路。

落库顺序遵循「任务先创建、后收敛终态」，保证异常也有终态可查（FR-R-01）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import RequestContext
from app.core.errors import NotFound
from app.graph.builder import AgentRunner
from app.graph.routing.base import LLMClassifier
from app.graph.runner import RunResult, run_workflow
from app.graph.spec import WorkflowSpec
from app.models import Application, HiddenResponse, TaskStatus, Workflow
from app.schemas.conversation import ChatRequest, ChatResponse, ConversationCreate
from app.services import conversations as conv_service
from app.services.tenants import ensure_tenant_matches


async def _load_spec(session: AsyncSession, app: Application) -> WorkflowSpec:
    """应用绑定默认工作流 → 解析为可执行规格；未绑定时用默认单 Agent 规格。"""
    if app.default_workflow_id:
        workflow = await session.get(Workflow, app.default_workflow_id)
        if workflow is not None and workflow.graph_definition:
            return WorkflowSpec.from_definition(workflow.graph_definition)
    return WorkflowSpec.from_definition({})


async def _run_safe(
    spec: WorkflowSpec,
    ctx: RequestContext,
    *,
    conversation_id: uuid.UUID,
    user_id: str,
    run_id: uuid.UUID,
    user_input: str,
    app_id: uuid.UUID,
    runner: AgentRunner | None,
    classifier: LLMClassifier | None,
) -> RunResult:
    """隔离图执行异常，保证调用方永远拿到 RunResult（结束态必达）。"""
    try:
        return await run_workflow(
            spec,
            tenant_id=str(ctx.tenant_id),
            application_id=str(app_id),
            conversation_id=str(conversation_id),
            user_id=user_id,
            run_id=str(run_id),
            user_input=user_input,
            runner=runner,
            classifier=classifier,
        )
    except Exception as exc:  # noqa: BLE001
        return RunResult(status=TaskStatus.FAILED, reason=f"调度异常: {exc}")


async def chat(
    session: AsyncSession,
    ctx: RequestContext,
    app_id: uuid.UUID,
    payload: ChatRequest,
    *,
    runner: AgentRunner | None = None,
    classifier: LLMClassifier | None = None,
) -> ChatResponse:
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

    # 1) 会话（不存在则新建）
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

    # 2) 用户消息
    await conv_service.append_message(
        session, ctx.tenant_id, conversation.id, "user", payload.message
    )

    # 3) 任务（先落 created，再转 running）
    run = await conv_service.create_run(
        session, ctx.tenant_id, conversation.id, {"message": payload.message}
    )
    await conv_service.start_run(session, run)

    # 4) 执行（异常已被收敛）
    spec = await _load_spec(session, app)
    result = await _run_safe(
        spec,
        ctx,
        conversation_id=conversation.id,
        user_id=payload.user_id,
        run_id=run.id,
        user_input=payload.message,
        app_id=app_id,
        runner=runner,
        classifier=classifier,
    )

    # 5) 收敛终态
    await conv_service.finish_run(
        session,
        run,
        status=result.status,
        output={"reply": result.reply, "route": result.route, "reason": result.reason},
        token_usage=result.token_usage,
    )

    # 6) 助手消息 + 隐藏返回（不进聊天框）
    hidden_out: list[dict] = []
    if result.reply:
        msg = await conv_service.append_message(
            session, ctx.tenant_id, conversation.id, "assistant", result.reply
        )
        for item in result.hidden:
            record = HiddenResponse(
                tenant_id=ctx.tenant_id,
                message_id=msg.id,
                run_id=run.id,
                action=str(item.get("action", "custom")),
                payload=item.get("payload") or {},
            )
            session.add(record)
            hidden_out.append({"action": record.action, "payload": record.payload})
        await session.flush()

    return ChatResponse(
        conversation_id=conversation.id,
        run_id=run.id,
        status=result.status,
        reply=result.reply,
        hidden_responses=hidden_out,
        token_usage=result.token_usage,
    )
