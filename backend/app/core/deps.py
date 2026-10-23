"""FastAPI 依赖：租户上下文、数据库会话、鉴权。"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import session_scope
from app.core.security import TokenError, verify_token


@dataclass(frozen=True)
class RequestContext:
    """每个请求的四层隔离上下文（PRD §3.2）。"""

    tenant_id: uuid.UUID
    app_id: uuid.UUID | None
    user_id: str | None
    request_id: str


def get_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", uuid.uuid4().hex)


async def get_db(
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> AsyncIterator[AsyncSession]:
    async with session_scope(x_tenant_id) as session:
        yield session


def _parse_uuid(value: str, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": 10001, "message": f"{field} 非法"},
        ) from exc


def get_context(
    request: Request,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_app_id: str | None = Header(default=None, alias="X-App-Id"),
    authorization: str | None = Header(default=None),
) -> RequestContext:
    """解析并校验请求上下文。

    约束：tenant_id 必填；app_id 视接口而定；用户身份从令牌解析。
    """
    user_id: str | None = None
    token_tenant: str | None = None
    token_app: str | None = None

    if authorization:
        scheme, _, raw = authorization.partition(" ")
        if scheme.lower() not in {"bearer", "token"} or not raw:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": 10002, "message": "鉴权头格式错误"},
            )
        try:
            claims = verify_token(raw)
        except TokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": 10002, "message": f"令牌无效: {exc}"},
            ) from exc
        user_id = claims.subject
        token_tenant = claims.tenant_id
        token_app = claims.app_id

    tenant_raw = x_tenant_id or token_tenant
    if not tenant_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": 10001, "message": "缺少租户上下文 X-Tenant-Id"},
        )

    # 租户上下文一致性校验：禁止跨租户访问
    if x_tenant_id and token_tenant and x_tenant_id != token_tenant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": 10003, "message": "租户上下文不一致，拒绝访问"},
        )

    tenant_id = _parse_uuid(tenant_raw, "X-Tenant-Id")
    app_raw = x_app_id or token_app
    app_id = _parse_uuid(app_raw, "X-App-Id") if app_raw else None
    if x_app_id and token_app and x_app_id != token_app:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": 10003, "message": "应用上下文不一致，拒绝访问"},
        )

    return RequestContext(
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        request_id=get_request_id(request),
    )


ContextDep = Depends(get_context)
DbDep = Depends(get_db)
