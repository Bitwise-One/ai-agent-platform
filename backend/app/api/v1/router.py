"""v1 路由聚合。

注册顺序说明：FastAPI 按注册顺序匹配，`chat` 放在最后是刻意的——
它的路径带 `apps/{app_id}/chat`，与其它 apps 子路由同前缀，
放后面可确保更具体的子路由（agents / workflows）先匹配。
"""

from fastapi import APIRouter

from app.api.v1 import (
    agents,
    applications,
    chat,
    conversations,
    integrations,
    knowledge,
    models,
    tenants,
    workflows,
)

api_router = APIRouter()
api_router.include_router(tenants.router)
api_router.include_router(applications.router)
api_router.include_router(models.router)
api_router.include_router(integrations.mcp_router)
api_router.include_router(integrations.skill_router)
api_router.include_router(agents.router)
api_router.include_router(workflows.router)
api_router.include_router(knowledge.router)
api_router.include_router(conversations.router)
api_router.include_router(chat.router)
api_router.include_router(chat.action_router)
