"""知识库、文档与检索的请求/响应模型。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = None


class KnowledgeBaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None
    embedding_model: str | None
    vector_dim: int | None
    created_at: datetime


class DocumentCreate(BaseModel):
    """M2 只支持纯文本入库；PDF/Word 解析在后续里程碑补充。"""

    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1)
    source: str | None = None
    file_type: str = "text"


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kb_id: uuid.UUID
    title: str
    source: str | None
    file_type: str | None
    status: str
    created_at: datetime


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=4, ge=1, le=20)


class SearchHit(BaseModel):
    content: str
    score: float
    document_id: str
    title: str


class SearchResponse(BaseModel):
    hits: list[SearchHit] = Field(default_factory=list)
    took_ms: int = 0
