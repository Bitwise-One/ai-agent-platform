"""知识库、文档、分块。"""

import uuid

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONType, SoftDeleteMixin, TimestampMixin


class KnowledgeBase(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "knowledge_base"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    embedding_model: Mapped[str | None] = mapped_column(String(128))
    vector_dim: Mapped[int | None] = mapped_column(Integer)


class Document(Base, SoftDeleteMixin):
    __tablename__ = "document"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    kb_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_base.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    source: Mapped[str | None] = mapped_column(String(512))
    file_type: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    access_scope: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)


class Chunk(Base):
    __tablename__ = "chunk"
    __table_args__ = (UniqueConstraint("document_id", "seq", name="uq_chunk_doc_seq"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenant.id"), nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("document.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    vector_id: Mapped[str | None] = mapped_column(String(128))
    token_count: Mapped[int | None] = mapped_column(Integer)
