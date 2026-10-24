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

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="知识库名称")
    description: Mapped[str | None] = mapped_column(Text, comment="知识库描述")
    # 记录使用的向量模型与维度，切换模型后需重建索引
    embedding_model: Mapped[str | None] = mapped_column(String(128), comment="使用的向量模型名，切换模型需重建索引")
    vector_dim: Mapped[int | None] = mapped_column(Integer, comment="向量维度，维度不一致会导致相似度计算失效")


class Document(Base, CreatedAtMixin, SoftDeleteMixin):
    """文档：知识库下的一个原始资料。"""

    __tablename__ = "document"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    kb_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_base.id"), nullable=False, index=True,
        comment="所属知识库",
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False, comment="文档标题")
    source: Mapped[str | None] = mapped_column(String(512), comment="原始来源（URL/上传路径）")
    file_type: Mapped[str | None] = mapped_column(String(32), comment="文件类型（pdf/md/docx 等）")
    # pending → parsing → indexed / failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", comment="状态：pending/parsing/indexed/failed")
    # 文档级访问范围（FR-K-07）：为空表示租户内可见
    access_scope: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, comment="文档级访问范围（空表示租户内可见）")


class Chunk(Base):
    """分块：检索的最小单位，携带向量。"""

    __tablename__ = "chunk"
    __table_args__ = (UniqueConstraint("document_id", "seq", name="uq_chunk_doc_seq"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, comment="主键，UUID")
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False, comment="所属租户（RLS 依赖）")
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("document.id"), nullable=False, index=True,
        comment="所属文档",
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False, comment="块序号（同文档内递增，保证切分顺序可重放）")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="分块纯文本内容")
    # 向量（float 列表）；无向量库时用于应用层余弦检索
    embedding: Mapped[list | None] = mapped_column(JSONType, comment="向量（float 列表），无向量库时用于应用层余弦检索")
    vector_id: Mapped[str | None] = mapped_column(String(128), comment="外部向量库中的 ID（若向量另存）")
    token_count: Mapped[int | None] = mapped_column(Integer, comment="块的 token 数（用于预算/截断）")
