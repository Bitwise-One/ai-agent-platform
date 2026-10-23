"""对话接口：一次请求跑通 LangGraph 全链路。"""

import uuid

from fastapi import APIRouter, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.schemas.common import ApiResponse
from app.schemas.conversation import ChatRequest, ChatResponse
from app.services import chat as chat_service

router = APIRouter(prefix="/apps", tags=["chat"])


@router.post("/{app_id}/chat", response_model=ApiResponse[ChatResponse])
async def chat(
    app_id: uuid.UUID,
    payload: ChatRequest,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ChatResponse]:
    result = await chat_service.chat(db, ctx, app_id, payload)
    return ApiResponse(data=result, request_id=get_request_id(request))
