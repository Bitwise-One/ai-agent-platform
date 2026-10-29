"""知识库接口：库 CRUD、文档入库、检索调试。"""

import time
import uuid

from fastapi import APIRouter, File, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import ContextDep, DbDep, RequestContext, get_request_id
from app.core.errors import AppError
from app.knowledge import service as kb_service
from app.schemas.common import ApiResponse
from app.schemas.knowledge import (
    DocumentCreate,
    DocumentOut,
    KnowledgeBaseCreate,
    KnowledgeBaseOut,
    KnowledgeBaseUpdate,
    SearchRequest,
    SearchResponse,
)

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge"])


@router.post("", response_model=ApiResponse[KnowledgeBaseOut])
async def create_kb(
    payload: KnowledgeBaseCreate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[KnowledgeBaseOut]:
    kb = await kb_service.create_kb(db, ctx.tenant_id, payload.name, payload.description)
    return ApiResponse(data=KnowledgeBaseOut.model_validate(kb), request_id=get_request_id(request))


@router.get("", response_model=ApiResponse[dict])
async def list_kbs(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    rows, total = await kb_service.list_kbs(
        db, ctx.tenant_id, offset=(page - 1) * page_size, limit=page_size
    )
    return ApiResponse(
        data={
            "items": [KnowledgeBaseOut.model_validate(r).model_dump() for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        },
        request_id=get_request_id(request),
    )


@router.get("/{kb_id}", response_model=ApiResponse[KnowledgeBaseOut])
async def get_kb(
    kb_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[KnowledgeBaseOut]:
    kb = await kb_service.get_kb(db, ctx.tenant_id, kb_id)
    return ApiResponse(data=KnowledgeBaseOut.model_validate(kb), request_id=get_request_id(request))


@router.patch("/{kb_id}", response_model=ApiResponse[KnowledgeBaseOut])
async def update_kb(
    kb_id: uuid.UUID,
    payload: KnowledgeBaseUpdate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[KnowledgeBaseOut]:
    kb = await kb_service.update_kb(db, ctx.tenant_id, kb_id, payload)
    return ApiResponse(data=KnowledgeBaseOut.model_validate(kb), request_id=get_request_id(request))


@router.delete("/{kb_id}", response_model=ApiResponse[dict])
async def delete_kb(
    kb_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await kb_service.delete_kb(db, ctx.tenant_id, kb_id)
    return ApiResponse(data={"deleted": str(kb_id)}, request_id=get_request_id(request))


# ---------------------------------------------------------------- 文档
@router.post("/{kb_id}/documents/upload", response_model=ApiResponse[DocumentOut])
async def upload_document(
    kb_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[DocumentOut]:
    """上传 UTF-8 文本，不执行文件内容、不使用文件名构造磁盘路径。"""
    try:
        await kb_service.get_kb(db, ctx.tenant_id, kb_id)
        filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        file_type = filename.rsplit(".", 1)[-1].lower()
        if file_type not in {"txt", "md"}:
            raise AppError(10001, "只支持 TXT/Markdown 文件", http_status=415)
        raw = await file.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise AppError(10001, "文件不能超过 2 MiB", http_status=413)
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise AppError(10001, "文件必须使用 UTF-8 编码", http_status=422) from exc
        if not content.strip() or "\x00" in content:
            raise AppError(10001, "文件必须包含有效文本正文", http_status=422)
        doc = await kb_service.ingest_document(
            db, ctx.tenant_id, kb_id,
            title=filename.rsplit(".", 1)[0] or filename,
            content=content, source=filename, file_type=file_type,
        )
        return ApiResponse(data=DocumentOut.model_validate(doc), request_id=get_request_id(request))
    finally:
        await file.close()


@router.post("/{kb_id}/documents", response_model=ApiResponse[DocumentOut])
async def ingest_document(
    kb_id: uuid.UUID,
    payload: DocumentCreate,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[DocumentOut]:
    doc = await kb_service.ingest_document(
        db,
        ctx.tenant_id,
        kb_id,
        title=payload.title,
        content=payload.content,
        source=payload.source,
        file_type=payload.file_type,
    )
    return ApiResponse(data=DocumentOut.model_validate(doc), request_id=get_request_id(request))


@router.get("/{kb_id}/documents", response_model=ApiResponse[dict])
async def list_documents(
    kb_id: uuid.UUID,
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await kb_service.get_kb(db, ctx.tenant_id, kb_id)
    rows, total = await kb_service.list_documents(
        db, ctx.tenant_id, kb_id, offset=(page - 1) * page_size, limit=page_size
    )
    return ApiResponse(
        data={
            "items": [DocumentOut.model_validate(r).model_dump() for r in rows],
            "total": total,
        },
        request_id=get_request_id(request),
    )


@router.delete("/{kb_id}/documents/{doc_id}", response_model=ApiResponse[dict])
async def delete_document(
    kb_id: uuid.UUID,
    doc_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[dict]:
    await kb_service.get_kb(db, ctx.tenant_id, kb_id)
    await kb_service.delete_document(db, ctx.tenant_id, doc_id, kb_id=kb_id)
    return ApiResponse(data={"deleted": str(doc_id)}, request_id=get_request_id(request))


# ---------------------------------------------------------------- 检索
@router.post("/{kb_id}/search", response_model=ApiResponse[SearchResponse])
async def search(
    kb_id: uuid.UUID,
    payload: SearchRequest,
    request: Request,
    ctx: RequestContext = ContextDep,
    db: AsyncSession = DbDep,
) -> ApiResponse[SearchResponse]:
    """检索调试接口：用于管理台验证召回质量（FR-K-10）。"""
    started = time.perf_counter()
    await kb_service.get_kb(db, ctx.tenant_id, kb_id)  # 先校验归属，跨租户直接 404
    hits = await kb_service.search(
        db, ctx.tenant_id, [kb_id], payload.query, top_k=payload.top_k
    )
    took_ms = int((time.perf_counter() - started) * 1000)
    return ApiResponse(
        data=SearchResponse(hits=[{k: h[k] for k in ("content", "score", "document_id", "title")} for h in hits], took_ms=took_ms),
        request_id=get_request_id(request),
    )
