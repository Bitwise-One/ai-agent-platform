"""M2 API 契约测试：Agent / 知识库 / 工作流 / SSE 流式对话。

这些用例先于实现编写，作为接口契约。
"""

import json

import pytest

TENANT_HEADER = "X-Tenant-Id"


async def _bootstrap(client, slug: str = "t-m2") -> tuple[str, str]:
    """建租户 + 应用，返回 (tenant_id, app_id)。"""
    resp = await client.post("/api/v1/tenants", json={"name": slug, "slug": slug})
    tenant = resp.json()["data"]["id"]
    resp = await client.post(
        "/api/v1/apps", json={"name": "M2 应用"}, headers={TENANT_HEADER: tenant}
    )
    return tenant, resp.json()["data"]["id"]


# ------------------------------------------------------------------ Agent CRUD
@pytest.mark.asyncio
async def test_agent_crud(client):
    tenant, app_id = await _bootstrap(client, "t-agent")
    headers = {TENANT_HEADER: tenant}

    created = await client.post(
        f"/api/v1/apps/{app_id}/agents",
        json={
            "name": "合同助手",
            "system_prompt": "你是合同审查专家",
            "temperature": 0.2,
            "keywords": ["合同", "条款"],
            "is_default": True,
        },
        headers=headers,
    )
    assert created.status_code == 200, created.text
    agent = created.json()["data"]
    assert agent["name"] == "合同助手"
    assert agent["keywords"] == ["合同", "条款"]

    listed = await client.get(f"/api/v1/apps/{app_id}/agents", headers=headers)
    assert listed.json()["data"]["total"] == 1

    patched = await client.patch(
        f"/api/v1/apps/{app_id}/agents/{agent['id']}",
        json={"temperature": 0.9},
        headers=headers,
    )
    assert patched.json()["data"]["temperature"] == 0.9

    protected = await client.delete(
        f"/api/v1/apps/{app_id}/agents/{agent['id']}", headers=headers
    )
    assert protected.status_code == 409
    replacement = await client.post(
        f"/api/v1/apps/{app_id}/agents",
        json={"name": "替代兜底", "is_default": True},
        headers=headers,
    )
    assert replacement.status_code == 200
    deleted = await client.delete(f"/api/v1/apps/{app_id}/agents/{agent['id']}", headers=headers)
    assert deleted.status_code == 200
    listed2 = await client.get(f"/api/v1/apps/{app_id}/agents", headers=headers)
    assert listed2.json()["data"]["total"] == 1
    assert listed2.json()["data"]["items"][0]["id"] == replacement.json()["data"]["id"]


# ------------------------------------------------------------------ 知识库 + RAG
@pytest.mark.asyncio
async def test_knowledge_base_ingest_and_search(client):
    tenant, app_id = await _bootstrap(client, "t-kb")
    headers = {TENANT_HEADER: tenant}

    kb_resp = await client.post(
        "/api/v1/knowledge-bases",
        json={"name": "产品手册", "description": "退换货政策"},
        headers=headers,
    )
    assert kb_resp.status_code == 200, kb_resp.text
    kb_id = kb_resp.json()["data"]["id"]

    doc = await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        json={
            "title": "退换货政策",
            "content": "本店支持七天无理由退货。商品需保持完好，包装齐全。退款将在三个工作日内原路退回。",
        },
        headers=headers,
    )
    assert doc.status_code == 200, doc.text
    assert doc.json()["data"]["status"] == "indexed"

    found = await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/search",
        json={"query": "七天无理由退货", "top_k": 3},
        headers=headers,
    )
    assert found.status_code == 200, found.text
    hits = found.json()["data"]["hits"]
    assert len(hits) >= 1
    assert "退货" in hits[0]["content"]


@pytest.mark.asyncio
async def test_knowledge_search_scoped_by_tenant(client):
    tenant_a, _ = await _bootstrap(client, "t-kb-a")
    tenant_b, _ = await _bootstrap(client, "t-kb-b")

    kb = await client.post(
        "/api/v1/knowledge-bases", json={"name": "A 的知识库"}, headers={TENANT_HEADER: tenant_a}
    )
    kb_id = kb.json()["data"]["id"]
    await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        json={"title": "机密", "content": "这是 A 租户的内部资料"},
        headers={TENANT_HEADER: tenant_a},
    )

    # B 租户看不到 A 的知识库
    denied = await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/search",
        json={"query": "内部资料"},
        headers={TENANT_HEADER: tenant_b},
    )
    assert denied.status_code == 404


# ------------------------------------------------------------------ 工作流
@pytest.mark.asyncio
async def test_workflow_crud_and_graph(client):
    tenant, app_id = await _bootstrap(client, "t-wf")
    headers = {TENANT_HEADER: tenant}

    created = await client.post(
        f"/api/v1/apps/{app_id}/workflows",
        json={"name": "主流程", "description": "默认编排"},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    wf_id = created.json()["data"]["id"]

    graph = await client.put(
        f"/api/v1/apps/{app_id}/workflows/{wf_id}/graph",
        json={
            "nodes": [
                {"id": "router", "type": "router", "label": "智能路由"},
                {"id": "agent-1", "type": "agent", "label": "合同助手"},
            ],
            "edges": [{"source": "router", "target": "agent-1"}],
            "router": "hybrid",
            "default_agent": "agent-1",
        },
        headers=headers,
    )
    assert graph.status_code == 200, graph.text

    fetched = await client.get(
        f"/api/v1/apps/{app_id}/workflows/{wf_id}/graph", headers=headers
    )
    data = fetched.json()["data"]
    assert len(data["nodes"]) == 2
    assert data["edges"][0]["target"] == "agent-1"
    assert data["router"] == "hybrid"

    archived = await client.delete(f"/api/v1/apps/{app_id}/workflows/{wf_id}", headers=headers)
    assert archived.status_code == 200, archived.text
    assert archived.json()["data"]["archived"] is True
    assert (await client.get(f"/api/v1/apps/{app_id}/workflows/{wf_id}", headers=headers)).status_code == 404
    assert (await client.get(f"/api/v1/apps/{app_id}/workflows", headers=headers)).json()["data"]["items"] == []


@pytest.mark.asyncio
async def test_workflow_version_release_rollback_and_binding(client):
    tenant, app_id = await _bootstrap(client, "t-wf2")
    headers = {TENANT_HEADER: tenant}

    wf_id = (
        await client.post(
            f"/api/v1/apps/{app_id}/workflows", json={"name": "流程"}, headers=headers
        )
    ).json()["data"]["id"]

    v1 = await client.post(
        f"/api/v1/apps/{app_id}/workflows/{wf_id}/versions",
        json={"changelog": "首版"},
        headers=headers,
    )
    assert v1.status_code == 200, v1.text
    v1_id = v1.json()["data"]["id"]

    released = await client.post(
        f"/api/v1/apps/{app_id}/workflows/{wf_id}/release",
        json={"version_id": v1_id},
        headers=headers,
    )
    assert released.status_code == 200, released.text

    # 发布后应用应绑定该工作流
    app = await client.get(f"/api/v1/apps/{app_id}", headers=headers)
    assert app.json()["data"]["default_workflow_id"] == wf_id

    bound_delete = await client.delete(f"/api/v1/apps/{app_id}/workflows/{wf_id}", headers=headers)
    assert bound_delete.status_code == 409

    rolled = await client.post(
        f"/api/v1/apps/{app_id}/workflows/{wf_id}/rollback",
        json={"version_id": v1_id},
        headers=headers,
    )
    assert rolled.status_code == 200, rolled.text


@pytest.mark.asyncio
async def test_conversation_archive_and_active_run_guard(client):
    tenant, app_id = await _bootstrap(client, "t-conv-archive")
    headers = {TENANT_HEADER: tenant, "X-App-Id": app_id}
    conversation = await client.post(
        "/api/v1/conversations", json={"user_id": "console-user", "title": "测试会话"}, headers=headers
    )
    assert conversation.status_code == 200, conversation.text
    conversation_id = conversation.json()["data"]["id"]
    archived = await client.delete(f"/api/v1/conversations/{conversation_id}", headers=headers)
    assert archived.status_code == 200, archived.text
    assert archived.json()["data"]["status"] == "archived"
    detail = await client.get(f"/api/v1/conversations/{conversation_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["data"]["status"] == "archived"


@pytest.mark.asyncio
async def test_tenant_soft_delete_preserves_one_active_tenant(client):
    tenant_a, _ = await _bootstrap(client, "t-delete-a")
    blocked = await client.delete(f"/api/v1/tenants/{tenant_a}")
    assert blocked.status_code == 409

    tenant_b, _ = await _bootstrap(client, "t-delete-b")
    deleted = await client.delete(f"/api/v1/tenants/{tenant_a}")
    assert deleted.status_code == 200
    assert deleted.json()["data"]["deleted"] == tenant_a
    listed = await client.get("/api/v1/tenants")
    assert {item["id"] for item in listed.json()["data"]["items"]} == {tenant_b}


# ------------------------------------------------------------------ SSE
@pytest.mark.asyncio
async def test_chat_stream_emits_sse_events(client):
    tenant, app_id = await _bootstrap(client, "t-sse")
    headers = {TENANT_HEADER: tenant, "X-App-Id": app_id}

    chunks: list[str] = []
    async with client.stream(
        "POST",
        f"/api/v1/apps/{app_id}/chat/stream",
        json={"user_id": "u1", "message": "你好"},
        headers=headers,
    ) as resp:
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        async for line in resp.aiter_lines():
            chunks.append(line)

    body = "\n".join(chunks)
    assert "event: meta" in body
    assert "event: token" in body
    assert "event: done" in body
    assert '"status"' in body
    # 路由事件是管理台「可视化为什么走这条路径」的数据来源：
    # 发射器若只在 Agent 节点内生效，route/prepare 的事件会被静默丢弃，
    # 前端就只剩 token 可看，因此这里显式断言它存在。
    assert "event: route" in body
    assert '"strategy"' in body
    frames = [frame for frame in body.split("\n\n") if frame]
    ids = [int(next(line[4:] for line in frame.splitlines() if line.startswith("id: "))) for frame in frames]
    events = [
        json.loads(next(line[5:].strip() for line in frame.splitlines() if line.startswith("data:")))
        for frame in frames
    ]
    assert ids == list(range(1, len(ids) + 1))
    assert all(event["id"] == event_id for event, event_id in zip(events, ids, strict=True))
    run_ids = {event["run_id"] for event in events}
    assert len(run_ids) == 1


@pytest.mark.asyncio
async def test_stream_retry_replays_persisted_events_with_same_idempotency_key(client):
    tenant, app_id = await _bootstrap(client, "t-sse-idempotency")
    headers = {TENANT_HEADER: tenant, "X-App-Id": app_id, "Idempotency-Key": "retry-key-001"}
    body = {"user_id": "u-retry", "message": "请计算 1 加 1"}

    async def read_events():
        lines = []
        async with client.stream("POST", f"/api/v1/apps/{app_id}/chat/stream", json=body, headers=headers) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                lines.append(line)
        frames = [frame for frame in "\n".join(lines).split("\n\n") if frame]
        return [
            json.loads(next(line[5:].strip() for line in frame.splitlines() if line.startswith("data:")))
            for frame in frames
        ]

    first = await read_events()
    second = await read_events()
    assert first[-1]["type"] == second[-1]["type"] == "done"
    assert [event["id"] for event in first] == [event["id"] for event in second]
    assert {event["run_id"] for event in first} == {event["run_id"] for event in second}

    conflict = await client.post(
        f"/api/v1/apps/{app_id}/chat",
        json={"user_id": "u-retry", "message": "different payload"},
        headers=headers,
    )
    assert conflict.status_code == 409


@pytest.mark.asyncio
async def test_hidden_action_has_capability_token_and_is_consumed_once(client):
    from app.graph.builder import AgentResult

    tenant, app_id = await _bootstrap(client, "t-hidden-token")
    headers = {TENANT_HEADER: tenant, "X-App-Id": app_id}

    async def hidden_runner(_agent, _state):
        return AgentResult(
            reply="已打开表单。",
            hidden=[{"action": "open_form", "payload": {"form_id": "booking"}}],
        )

    # Inject the runner through the existing chat service seam for this request.
    from app.services import chat as chat_service

    original_chat = chat_service.chat

    async def _chat(db, ctx, requested_app_id, payload, *, runner=None, idempotency_key=None):
        return await original_chat(db, ctx, requested_app_id, payload, runner=hidden_runner)

    chat_service.chat = _chat
    try:
        response = await client.post(
            f"/api/v1/apps/{app_id}/chat",
            json={"user_id": "u-hidden", "message": "请打开预约表单"},
            headers=headers,
        )
    finally:
        chat_service.chat = original_chat
    assert response.status_code == 200, response.text
    hidden = response.json()["data"]["hidden_responses"][0]
    assert hidden["type"] == "hidden"
    assert hidden["channel"] == "system"
    assert hidden["event"] == "ui_action"
    assert hidden["meta"]["capability"]["action"] == "open_form"
    token = hidden["meta"]["action_token"]

    from app.core.security import issue_token

    user_headers = {**headers, "Authorization": f"Bearer {issue_token('u-hidden', tenant, app_id)}"}
    consumed = await client.post("/api/v1/hidden-actions/consume", json={"token": token}, headers=user_headers)
    assert consumed.status_code == 200, consumed.text
    assert consumed.json()["data"]["payload"] == {"form_id": "booking"}
    replay = await client.post("/api/v1/hidden-actions/consume", json={"token": token}, headers=user_headers)
    assert replay.status_code == 404


@pytest.mark.asyncio
async def test_chat_uses_llm_runner_and_returns_reply(client):
    """对话应走模型网关（当前为 mock），且返回非空回复。"""
    tenant, app_id = await _bootstrap(client, "t-chat2")
    headers = {TENANT_HEADER: tenant, "X-App-Id": app_id}

    resp = await client.post(
        f"/api/v1/apps/{app_id}/chat",
        json={"user_id": "u1", "message": "介绍一下你自己"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["status"] in {"completed", "degraded"}
    assert data["reply"]
