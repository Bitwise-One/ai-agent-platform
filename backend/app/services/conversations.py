"""会话服务：运行时隔离单元的唯一入口。

任何会话读写都必须同时带 tenant_id + application_id 作用域，
并校验 user_id 归属（PRD §3.2、FR-CV-06）。
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, NotFound
from app.models import Conversation, Message, TaskRun, TaskStatus
from app.models.base import utcnow
from app.schemas.common import PageQuery
from app.schemas.conversation import ConversationCreate


async def create_conversation(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    payload: ConversationCreate,
) -> Conversation:
    conv = Conversation(
        tenant_id=tenant_id,
        application_id=app_id,
        user_id=payload.user_id,
        title=payload.title,
        metadata_=payload.metadata,
    )
    session.add(conv)
    await session.flush()
    return conv


async def get_conversation(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    conversation_id: uuid.UUID,
    user_id: str | None = None,
) -> Conversation:
    conv = await session.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.tenant_id == tenant_id,
            Conversation.application_id == app_id,
        )
    )
    if conv is None:
        raise NotFound("会话不存在")
    if user_id is not None and conv.user_id != user_id:
        raise Forbidden("无权访问该会话")
    return conv


async def archive_conversation(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    conversation_id: uuid.UUID,
    user_id: str | None = None,
) -> Conversation:
    conv = await get_conversation(session, tenant_id, app_id, conversation_id, user_id=user_id)
    active_run = await session.scalar(
        select(TaskRun.id).where(
            TaskRun.conversation_id == conversation_id,
            TaskRun.status.not_in(TaskStatus.TERMINAL),
        ).limit(1)
    )
    if active_run:
        from app.core.errors import Conflict

        raise Conflict("会话仍有执行中的任务，请等待任务结束后再归档")
    conv.status = "archived"
    conv.archived_at = utcnow()
    await session.flush()
    return conv


async def list_conversations(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    page: PageQuery,
    user_id: str | None = None,
) -> tuple[list[Conversation], int]:
    conditions = [
        Conversation.tenant_id == tenant_id,
        Conversation.application_id == app_id,
    ]
    if user_id is not None:
        conditions.append(Conversation.user_id == user_id)

    base = select(Conversation).where(*conditions)
    total = await session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = await session.scalars(
        base.order_by(Conversation.updated_at.desc())
        .offset(page.offset)
        .limit(page.page_size)
    )
    return list(rows), total


async def list_messages(
    session: AsyncSession,
    conversation_id: uuid.UUID,
    page: PageQuery,
) -> tuple[list[Message], int]:
    base = select(Message).where(Message.conversation_id == conversation_id)
    total = await session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = await session.scalars(
        base.order_by(Message.created_at.asc()).offset(page.offset).limit(page.page_size)
    )
    return list(rows), total


async def append_message(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    role: str,
    content: str | None,
    tool_calls: dict | None = None,
) -> Message:
    msg = Message(
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        role=role,
        content=content,
        tool_calls=tool_calls,
    )
    session.add(msg)
    await session.flush()
    return msg


async def create_run(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    conversation_id: uuid.UUID,
    payload: dict,
) -> TaskRun:
    run = TaskRun(
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        status=TaskStatus.CREATED,
        input=payload,
    )
    session.add(run)
    await session.flush()
    return run


async def start_run(session: AsyncSession, run: TaskRun) -> TaskRun:
    """created → running：执行前先落状态，保证状态机合法。"""
    if not TaskStatus.can_transition(run.status, TaskStatus.RUNNING):
        raise Forbidden(f"非法状态迁移: {run.status} -> {TaskStatus.RUNNING}")
    run.status = TaskStatus.RUNNING
    run.started_at = utcnow()
    await session.flush()
    return run


async def finish_run(
    session: AsyncSession,
    run: TaskRun,
    status: str,
    output: dict | None = None,
    error: dict | None = None,
    token_usage: int = 0,
) -> TaskRun:
    if not TaskStatus.can_transition(run.status, status):
        raise Forbidden(f"非法状态迁移: {run.status} -> {status}")
    run.status = status
    run.output = output
    run.error = error
    run.token_usage = token_usage
    run.finished_at = utcnow()
    await session.flush()
    return run
