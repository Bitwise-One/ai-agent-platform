"""工作流服务：图定义、版本快照、发布与回滚。

版本模型（PRD FR-V-01/02/05）：
- 每次「发布」都会先固化为不可变快照（WorkflowVersion），再指向它；
- 回滚 = 把 current_version 指回旧快照，图定义同步回滚；
- 应用与工作流的绑定（application.default_workflow_id）在发布时可一并更新。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.models import Application, Workflow, WorkflowVersion
from app.models.base import utcnow
from app.schemas.workflow import GraphDefinition, WorkflowCreate, WorkflowUpdate


# ---------------------------------------------------------------- 基础 CRUD
async def create_workflow(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, payload: WorkflowCreate
) -> Workflow:
    wf = Workflow(
        tenant_id=tenant_id,
        application_id=app_id,
        name=payload.name,
        description=payload.description,
        graph_definition=payload.graph_definition or {},
    )
    session.add(wf)
    await session.flush()
    return wf


async def list_workflows(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID
) -> list[Workflow]:
    rows = await session.scalars(
        select(Workflow)
        .where(
            Workflow.tenant_id == tenant_id,
            Workflow.application_id == app_id,
            Workflow.deleted_at.is_(None),
        )
        .order_by(Workflow.created_at.asc())
    )
    return list(rows)


async def get_workflow(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, wf_id: uuid.UUID
) -> Workflow:
    wf = await session.scalar(
        select(Workflow).where(
            Workflow.id == wf_id,
            Workflow.tenant_id == tenant_id,
            Workflow.application_id == app_id,
            Workflow.deleted_at.is_(None),
        )
    )
    if wf is None:
        raise NotFound("工作流不存在")
    return wf


async def update_workflow(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    payload: WorkflowUpdate,
) -> Workflow:
    wf = await get_workflow(session, tenant_id, app_id, wf_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(wf, key, value)
    await session.flush()
    return wf


async def archive_workflow(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, wf_id: uuid.UUID
) -> None:
    wf = await get_workflow(session, tenant_id, app_id, wf_id)
    app = await session.scalar(select(Application).where(Application.id == app_id, Application.tenant_id == tenant_id))
    if app and app.default_workflow_id == wf.id:
        raise Conflict("该工作流当前绑定为应用默认流程，请先切换默认工作流后再归档")
    wf.deleted_at = utcnow()
    wf.status = "archived"
    wf.updated_at = utcnow()
    await session.flush()


# ---------------------------------------------------------------- 可视化编排
async def get_graph(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, wf_id: uuid.UUID
) -> GraphDefinition:
    """读取编排数据；旧数据缺字段时用默认值补全，保证前端可渲染。"""
    wf = await get_workflow(session, tenant_id, app_id, wf_id)
    return GraphDefinition(**(wf.graph_definition or {}))


async def save_graph(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    graph: GraphDefinition,
) -> Workflow:
    """保存编排数据。

    这里做一次最小拓扑校验：边引用的节点必须存在，
    避免前端保存出「悬空连线」导致运行时路由失败。
    """
    wf = await get_workflow(session, tenant_id, app_id, wf_id)

    node_ids = {n.id for n in graph.nodes}
    for edge in graph.edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            raise Conflict(f"连线引用了不存在的节点: {edge.source} -> {edge.target}")

    if graph.default_agent and graph.default_agent not in node_ids and graph.nodes:
        raise Conflict(f"默认 Agent 不存在于画布: {graph.default_agent}")

    wf.graph_definition = graph.model_dump()
    await session.flush()
    return wf


# ---------------------------------------------------------------- 版本与发布
async def create_version(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    changelog: str | None = None,
    snapshot: dict | None = None,
) -> WorkflowVersion:
    """生成不可变版本快照，版本号自增。"""
    wf = await get_workflow(session, tenant_id, app_id, wf_id)

    current_max = (
        await session.scalar(
            select(func.max(WorkflowVersion.version)).where(
                WorkflowVersion.workflow_id == wf_id
            )
        )
        or 0
    )
    version = WorkflowVersion(
        workflow_id=wf_id,
        version=current_max + 1,
        snapshot=snapshot or wf.graph_definition or {},
        changelog=changelog,
        status="draft",
    )
    session.add(version)
    await session.flush()
    return version


async def list_versions(
    session: AsyncSession, tenant_id: uuid.UUID, app_id: uuid.UUID, wf_id: uuid.UUID
) -> list[WorkflowVersion]:
    await get_workflow(session, tenant_id, app_id, wf_id)
    rows = await session.scalars(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == wf_id)
        .order_by(WorkflowVersion.version.desc())
    )
    return list(rows)


async def release(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    version_id: uuid.UUID | None,
    bind_to_app: bool = True,
) -> WorkflowVersion:
    """发布指定版本（默认取最新版本）。

    动作：版本置 released、工作流 current_version 指向它、状态 published，
    可选把应用默认工作流绑定到该工作流。
    """
    wf = await get_workflow(session, tenant_id, app_id, wf_id)

    if version_id is None:
        version = await session.scalar(
            select(WorkflowVersion)
            .where(WorkflowVersion.workflow_id == wf_id)
            .order_by(WorkflowVersion.version.desc())
            .limit(1)
        )
    else:
        version = await session.scalar(
            select(WorkflowVersion).where(
                WorkflowVersion.id == version_id, WorkflowVersion.workflow_id == wf_id
            )
        )
    if version is None:
        raise NotFound("工作流版本不存在")

    version.status = "released"
    wf.current_version_id = version.id
    wf.status = "published"
    wf.graph_definition = version.snapshot

    if bind_to_app:
        app = await session.get(Application, app_id)
        if app is not None and app.tenant_id == tenant_id:
            app.default_workflow_id = wf.id

    await session.flush()
    return version


async def rollback(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    app_id: uuid.UUID,
    wf_id: uuid.UUID,
    version_id: uuid.UUID,
) -> WorkflowVersion:
    """回滚到指定历史版本：图定义与指针同时回退。"""
    wf = await get_workflow(session, tenant_id, app_id, wf_id)
    version = await session.scalar(
        select(WorkflowVersion).where(
            WorkflowVersion.id == version_id, WorkflowVersion.workflow_id == wf_id
        )
    )
    if version is None:
        raise NotFound("工作流版本不存在")

    wf.current_version_id = version.id
    wf.graph_definition = version.snapshot
    version.status = "rolled_back"
    await session.flush()
    return version
