"""模型配置接口：租户级模型目录 + 连通性探测。

路由挂在 `/api/v1/models` 而不是 `apps/{app_id}/models`，因为模型配置是
**租户级**资源：同一租户下的多个应用共用同一份模型清单，避免重复维护。
Agent 通过 `model_config_id` 引用它（见 agents 接口），因此换模型不用改提示词。
"""

import uuid

from fastapi import APIRouter, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.schemas.common import ApiResponse
from app.schemas.model import (
    ModelConfigCreate,
    ModelConfigOut,
    ModelConfigUpdate,
    ModelCredentialWrite,
    ModelProbeResult,
)
from app.services import models as model_service

router = APIRouter(prefix="/models", tags=["models"])


@router.put("/{config_id}/credential", response_model=ApiResponse[dict])
async def write_model_credential(
    config_id: uuid.UUID,
    payload: ModelCredentialWrite,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    configured = await model_service.set_model_credential(
        db, ctx.tenant_id, config_id, payload.api_key if payload.action == "set" else None
    )
    return ApiResponse(data={"configured": configured}, request_id=get_request_id(request))


@router.post("", response_model=ApiResponse[ModelConfigOut])
async def create_model(
    payload: ModelConfigCreate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ModelConfigOut]:
    """新增一条模型配置（只描述模型，不含密钥）。"""
    record = await model_service.create_model_config(db, ctx.tenant_id, payload)
    return ApiResponse(data=ModelConfigOut.model_validate(record), request_id=get_request_id(request))


@router.get("", response_model=ApiResponse[dict])
async def list_models(
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    """列出本租户的全部模型配置，供控制台下拉选择。"""
    rows = await model_service.list_model_configs(db, ctx.tenant_id)
    return ApiResponse(
        data={
            "items": [ModelConfigOut.model_validate(r).model_dump() for r in rows],
            "total": len(rows),
        },
        request_id=get_request_id(request),
    )


@router.get("/{config_id}", response_model=ApiResponse[ModelConfigOut])
async def get_model(
    config_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ModelConfigOut]:
    record = await model_service.get_model_config(db, ctx.tenant_id, config_id)
    return ApiResponse(data=ModelConfigOut.model_validate(record), request_id=get_request_id(request))


@router.patch("/{config_id}", response_model=ApiResponse[ModelConfigOut])
async def update_model(
    config_id: uuid.UUID,
    payload: ModelConfigUpdate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ModelConfigOut]:
    record = await model_service.update_model_config(db, ctx.tenant_id, config_id, payload)
    return ApiResponse(data=ModelConfigOut.model_validate(record), request_id=get_request_id(request))


@router.delete("/{config_id}", response_model=ApiResponse[dict])
async def delete_model(
    config_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await model_service.delete_model_config(db, ctx.tenant_id, config_id)
    return ApiResponse(data={"deleted": str(config_id)}, request_id=get_request_id(request))


@router.post("/{config_id}/probe", response_model=ApiResponse[ModelProbeResult])
async def probe_model(
    config_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[ModelProbeResult]:
    """探测该模型在当前部署下是否可用。

    返回 `ready=False` 表示网关尚未接入真实模型（走 mock），
    这属于环境未配置，而非用户填错模型名。
    """
    result = await model_service.probe(db, ctx.tenant_id, config_id)
    return ApiResponse(data=result, request_id=get_request_id(request))
