"""对话接口：非流式 + SSE 流式。

SSE 事件格式（对应 design/api.md §4.2）：

    event: token
    data: {"text": "你"}

事件类型：meta / status / route / rag / token / hidden / done
注意：`done` 必发，即使执行失败，避免前端永久等待。
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
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
    """非流式对话：阻塞直到图执行完成。"""
    result = await chat_service.chat(db, ctx, app_id, payload)
    return ApiResponse(data=result, request_id=get_request_id(request))


def _format_sse(event: dict) -> str:
    """把事件字典序列化成 SSE 帧。

    `event` 字段取事件类型，`data` 为完整 JSON（含 type 便于前端二次判断）。
    """
    event_type = event.get("type", "message")
    event_id = event.get("id")
    body = json.dumps(event, ensure_ascii=False)
    return f"id: {event_id}\nevent: {event_type}\ndata: {body}\n\n"


@router.post("/{app_id}/chat/stream")
async def chat_stream(
    app_id: uuid.UUID,
    payload: ChatRequest,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> StreamingResponse:
    """SSE 流式对话。

    注意事项：
    - 依赖注入的 `db` 会话在整个流式响应期间保持打开，生成器内可直接复用；
    - `X-Accel-Buffering: no` 关闭 Nginx 缓冲，避免 token 被攒批下发。
    """

    async def _gen():
        sequence = 0
        run_id: str | None = None
        try:
            async for event in chat_service.stream_chat(db, ctx, app_id, payload):
                if event.get("type") == "meta":
                    run_id = event.get("run_id")
                sequence += 1
                yield _format_sse({**event, "id": sequence, "run_id": run_id})
        except Exception as exc:  # noqa: BLE001 - 兜底：任何异常都要给前端终止信号
            run_id = run_id or f"unstarted-{get_request_id(request)}"
            sequence += 1
            yield _format_sse({"type": "error", "id": sequence, "run_id": run_id, "message": str(exc)[:500]})
            sequence += 1
            yield _format_sse({"type": "done", "id": sequence, "run_id": run_id, "status": "failed"})

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
