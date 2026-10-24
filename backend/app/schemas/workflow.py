"""工作流与可视化编排数据模型。

编排数据采用「React Flow 风格」的 nodes/edges：
- 前端可视化编辑器可直接消费，无需二次转换；
- 后端只把它当作不透明 JSON 存储 + 少量结构化字段（router / default_agent）。
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None
    graph_definition: dict = Field(default_factory=dict)


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    description: str | None = None
    status: str | None = None


class WorkflowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    application_id: uuid.UUID
    name: str
    description: str | None
    current_version_id: uuid.UUID | None
    status: str
    created_at: datetime
    updated_at: datetime


class GraphNode(BaseModel):
    """画布节点。type: router / agent / rag / guard / fallback / condition"""

    id: str
    type: str = "agent"
    label: str = ""
    position: dict = Field(default_factory=dict)
    data: dict = Field(default_factory=dict)


class GraphEdge(BaseModel):
    source: str
    target: str
    label: str | None = None
    condition: str | None = None


class GraphDefinition(BaseModel):
    """可视化编排数据（读写同一结构）。"""

    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    router: str = "hybrid"
    default_agent: str | None = None
    max_iterations: int = 20
    confidence_threshold: float = 0.6
    rag_enabled: bool = True
    rag_top_k: int = 4


class WorkflowVersionCreate(BaseModel):
    changelog: str | None = None
    # 不传则用当前 graph_definition 打快照
    snapshot: dict | None = None


class WorkflowVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_id: uuid.UUID
    version: int
    changelog: str | None
    status: str
    created_at: datetime


class ReleaseRequest(BaseModel):
    """发布：把某个版本置为生效版本，并把应用绑定到该工作流。"""

    version_id: uuid.UUID | None = None
    bind_to_app: bool = True


class RollbackRequest(BaseModel):
    version_id: uuid.UUID
