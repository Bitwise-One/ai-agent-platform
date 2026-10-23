"""v1 路由聚合。"""

from fastapi import APIRouter

from app.api.v1 import applications, chat, conversations, tenants

api_router = APIRouter()
api_router.include_router(tenants.router)
api_router.include_router(applications.router)
api_router.include_router(conversations.router)
api_router.include_router(chat.router)
