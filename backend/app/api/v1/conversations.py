"""会话接口：会话隔离的对外入口。"""

import uuid

from fastapi import APIRouter, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.schemas.common import ApiResponse, Page, PageQuery
from app.schemas.conversation import (
    ConversationCreate,
    ConversationOut,
    MessageOut,
)
from app.services import conversations as conv_service

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _require_app(ctx: RequestContext) -> uuid.UUID:
    from app.core.errors import AppError

    if ctx.app_id is None:
        raise AppError(10001, "缺少应用上下文 X-App-Id")
    return ctx.app_id


@router.post("", response_model=ApiResponse[ConversationOut])
async def create_conversation(
    payload: ConversationCreate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ConversationOut]:
    app_id = _require_app(ctx)
    conv = await conv_service.create_conversation(db, ctx.tenant_id, app_id, payload)
    return ApiResponse(
        data=ConversationOut.model_validate(conv), request_id=get_request_id(request)
    )


@router.get("", response_model=ApiResponse[Page[ConversationOut]])
async def list_conversations(
    request: Request,
    user_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[Page[ConversationOut]]:
    app_id = _require_app(ctx)
    rows, total = await conv_service.list_conversations(
        db, ctx.tenant_id, app_id, PageQuery(page=page, page_size=page_size), user_id=user_id
    )
    return ApiResponse(
        data=Page[ConversationOut](
            items=[ConversationOut.model_validate(r) for r in rows],
            total=total,
            page=page,
            page_size=page_size,
        ),
        request_id=get_request_id(request),
    )


@router.get("/{conversation_id}", response_model=ApiResponse[ConversationOut])
async def get_conversation(
    conversation_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ConversationOut]:
    app_id = _require_app(ctx)
    conv = await conv_service.get_conversation(
        db, ctx.tenant_id, app_id, conversation_id, user_id=ctx.user_id
    )
    return ApiResponse(
        data=ConversationOut.model_validate(conv), request_id=get_request_id(request)
    )


@router.get("/{conversation_id}/messages", response_model=ApiResponse[Page[MessageOut]])
async def list_messages(
    conversation_id: uuid.UUID,
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[Page[MessageOut]]:
    app_id = _require_app(ctx)
    # 先校验会话归属，再取消息
    await conv_service.get_conversation(
        db, ctx.tenant_id, app_id, conversation_id, user_id=ctx.user_id
    )
    rows, total = await conv_service.list_messages(
        db, conversation_id, PageQuery(page=page, page_size=page_size)
    )
    return ApiResponse(
        data=Page[MessageOut](
            items=[MessageOut.model_validate(r) for r in rows],
            total=total,
            page=page,
            page_size=page_size,
        ),
        request_id=get_request_id(request),
    )
