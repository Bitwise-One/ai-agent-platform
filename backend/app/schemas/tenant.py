"""租户与应用的请求/响应模型。"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")
    quota: dict = Field(default_factory=dict)


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    status: Literal["active", "suspended"] | None = None
    quota: dict | None = None


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    status: str
    quota: dict
    created_at: datetime


class ApplicationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    icon: str | None = None
    default_model_params: dict = Field(default_factory=dict)


class ApplicationUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    status: str | None = None
    default_workflow_id: uuid.UUID | None = None
    default_model_params: dict | None = None


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None
    icon: str | None
    default_workflow_id: uuid.UUID | None
    status: str
    created_at: datetime
