"""知识库、文档、分块。

RAG 的存储设计取舍（M2）：
- 向量以 JSON 数组存在 `chunk.embedding`，检索时在应用层算余弦相似度；
- 好处：不依赖 pgvector 扩展，SQLite/PG 都能跑，便于本地与 CI；
- 代价：检索是 O(候选块数)，仅适合中小规模知识库。
- 升级路径：数据量大时切 pgvector / Milvus，`embedding` 列改为 vector 类型，
  检索下沉到数据库，服务层接口（retriever）保持不变。
"""

import uuid

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, JSONType, SoftDeleteMixin, TimestampMixin


class KnowledgeBase(Base, TimestampMixin, SoftDeleteMixin):
    """知识库：租户级资源，可被多个 Agent 引用。"""

    __tablename__ = "knowledge_base"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # 记录使用的向量模型与维度，切换模型后需重建索引
    embedding_model: Mapped[str | None] = mapped_column(String(128))
    vector_dim: Mapped[int | None] = mapped_column(Integer)


class Document(Base, CreatedAtMixin, SoftDeleteMixin):
    """文档：知识库下的一个原始资料。"""

    __tablename__ = "document"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    kb_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_base.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    source: Mapped[str | None] = mapped_column(String(512))
    file_type: Mapped[str | None] = mapped_column(String(32))
    # pending → parsing → indexed / failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    # 文档级访问范围（FR-K-07）：为空表示租户内可见
    access_scope: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)


class Chunk(Base):
    """分块：检索的最小单位，携带向量。"""

    __tablename__ = "chunk"
    __table_args__ = (UniqueConstraint("document_id", "seq", name="uq_chunk_doc_seq"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("document.id"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 向量（float 列表）；无向量库时用于应用层余弦检索
    embedding: Mapped[list | None] = mapped_column(JSONType)
    vector_id: Mapped[str | None] = mapped_column(String(128))
    token_count: Mapped[int | None] = mapped_column(Integer)
