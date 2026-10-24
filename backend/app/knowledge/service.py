"""知识库服务：入库（切分 + 向量化）与检索。

职责：
- 入库：文本 → 切分 → 批量向量化 → 落 chunk（含向量与 token 估算）；
- 检索：查询向量化 → 在指定知识库范围内做余弦排序 → 返回命中片段；
- 全程强制 tenant_id 作用域，跨租户不可见（FR-K-07）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import NotFound
from app.gateway import get_gateway
from app.knowledge.chunker import estimate_tokens, split_text
from app.knowledge.retriever import rank
from app.models import Chunk, Document, KnowledgeBase
from app.models.base import utcnow

# 单次检索最多加载的候选块数量，防止内存被打爆
CANDIDATE_LIMIT = 2000


# ---------------------------------------------------------------- 知识库 CRUD
async def create_kb(
    session: AsyncSession, tenant_id: uuid.UUID, name: str, description: str | None = None
) -> KnowledgeBase:
    gateway = get_gateway()
    kb = KnowledgeBase(
        tenant_id=tenant_id,
        name=name,
        description=description,
        embedding_model=(
            get_settings().embedding_model if gateway.embedding_ready else "mock"
        ),
        vector_dim=gateway.embedding_dim,
    )
    session.add(kb)
    await session.flush()
    return kb


async def list_kbs(
    session: AsyncSession, tenant_id: uuid.UUID, offset: int = 0, limit: int = 20
) -> tuple[list[KnowledgeBase], int]:
    base = select(KnowledgeBase).where(
        KnowledgeBase.tenant_id == tenant_id, KnowledgeBase.deleted_at.is_(None)
    )
    total = await session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = await session.scalars(
        base.order_by(KnowledgeBase.created_at.desc()).offset(offset).limit(limit)
    )
    return list(rows), total


async def get_kb(
    session: AsyncSession, tenant_id: uuid.UUID, kb_id: uuid.UUID
) -> KnowledgeBase:
    kb = await session.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.id == kb_id,
            KnowledgeBase.tenant_id == tenant_id,
            KnowledgeBase.deleted_at.is_(None),
        )
    )
    if kb is None:
        raise NotFound("知识库不存在")
    return kb


async def delete_kb(session: AsyncSession, tenant_id: uuid.UUID, kb_id: uuid.UUID) -> None:
    """软删除知识库，并同步软删其下文档，避免残留可被检索。"""
    kb = await get_kb(session, tenant_id, kb_id)
    kb.deleted_at = utcnow()
    docs = await session.scalars(
        select(Document).where(Document.kb_id == kb_id, Document.deleted_at.is_(None))
    )
    for doc in docs:
        doc.deleted_at = utcnow()
    await session.flush()


# ---------------------------------------------------------------- 文档入库
async def ingest_document(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    kb_id: uuid.UUID,
    *,
    title: str,
    content: str,
    source: str | None = None,
    file_type: str | None = "text",
) -> Document:
    """入库一篇文档：切分 → 向量化 → 写 chunk。

    失败时文档状态置为 failed，异常继续向上抛，由接口层返回可解释错误。
    """
    settings = get_settings()
    await get_kb(session, tenant_id, kb_id)

    doc = Document(
        tenant_id=tenant_id,
        kb_id=kb_id,
        title=title,
        source=source,
        file_type=file_type,
        status="parsing",
        access_scope={},
    )
    session.add(doc)
    await session.flush()

    pieces = split_text(content, settings.rag_chunk_size, settings.rag_chunk_overlap)
    if not pieces:
        doc.status = "failed"
        await session.flush()
        return doc

    gateway = get_gateway()
    try:
        vectors = await gateway.embed(pieces)
    except Exception:
        doc.status = "failed"
        await session.flush()
        raise

    for seq, (piece, vector) in enumerate(zip(pieces, vectors, strict=False)):
        session.add(
            Chunk(
                tenant_id=tenant_id,
                document_id=doc.id,
                seq=seq,
                content=piece,
                embedding=vector,
                token_count=estimate_tokens(piece),
            )
        )

    doc.status = "indexed"
    await session.flush()
    return doc


async def list_documents(
    session: AsyncSession, tenant_id: uuid.UUID, kb_id: uuid.UUID, offset: int = 0, limit: int = 20
) -> tuple[list[Document], int]:
    base = select(Document).where(
        Document.tenant_id == tenant_id,
        Document.kb_id == kb_id,
        Document.deleted_at.is_(None),
    )
    total = await session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = await session.scalars(
        base.order_by(Document.created_at.desc()).offset(offset).limit(limit)
    )
    return list(rows), total


async def delete_document(
    session: AsyncSession, tenant_id: uuid.UUID, doc_id: uuid.UUID
) -> None:
    """软删文档，同时删除其 chunk，防止已删内容仍被召回（FR-K-12）。"""
    doc = await session.scalar(
        select(Document).where(
            Document.id == doc_id,
            Document.tenant_id == tenant_id,
            Document.deleted_at.is_(None),
        )
    )
    if doc is None:
        raise NotFound("文档不存在")

    doc.deleted_at = utcnow()
    chunks = await session.scalars(select(Chunk).where(Chunk.document_id == doc_id))
    for chunk in chunks:
        await session.delete(chunk)
    await session.flush()


# ---------------------------------------------------------------- 检索
async def search(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    kb_ids: list[uuid.UUID],
    query: str,
    *,
    top_k: int = 4,
    min_score: float | None = None,
) -> list[dict]:
    """在指定知识库范围内检索。

    Args:
        kb_ids: 知识库范围；空列表直接返回空（不跨库乱查）。
        query: 查询文本。
        top_k: 返回条数。
        min_score: 相关度下限，低于则丢弃（避免强行编造，FR-K-11）。

    Returns:
        命中列表，每项含 content / score / document_id / title。
    """
    if not kb_ids or not query.strip():
        return []

    settings = get_settings()
    threshold = settings.rag_min_score if min_score is None else min_score

    # 只取未删除文档下的块，并限制候选量
    rows = await session.execute(
        select(Chunk.id, Chunk.content, Chunk.embedding, Document.id, Document.title)
        .join(Document, Document.id == Chunk.document_id)
        .where(
            Chunk.tenant_id == tenant_id,
            Document.kb_id.in_(kb_ids),
            Document.deleted_at.is_(None),
        )
        .limit(CANDIDATE_LIMIT)
    )

    candidates = [
        {
            "chunk_id": str(row[0]),
            "content": row[1],
            "embedding": row[2],
            "document_id": str(row[3]),
            "title": row[4],
        }
        for row in rows.all()
    ]
    if not candidates:
        return []

    query_vec = (await get_gateway().embed([query]))[0]
    return rank(query_vec, candidates, top_k=top_k, min_score=threshold)
