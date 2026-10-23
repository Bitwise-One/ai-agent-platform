"""四层隔离集成测试：租户 / 应用 / 会话 / 用户。"""

import pytest


async def _create_tenant(client, slug: str) -> str:
    resp = await client.post("/api/v1/tenants", json={"name": slug, "slug": slug})
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["id"]


async def _create_app(client, tenant_id: str, name: str) -> str:
    resp = await client.post(
        "/api/v1/apps", json={"name": name}, headers={"X-Tenant-Id": tenant_id}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["id"]


@pytest.mark.asyncio
async def test_cannot_read_other_tenant_app(client):
    tenant_a = await _create_tenant(client, "tenant-a")
    tenant_b = await _create_tenant(client, "tenant-b")
    app_a = await _create_app(client, tenant_a, "应用A")

    ok = await client.get(f"/api/v1/apps/{app_a}", headers={"X-Tenant-Id": tenant_a})
    assert ok.status_code == 200

    denied = await client.get(f"/api/v1/apps/{app_a}", headers={"X-Tenant-Id": tenant_b})
    assert denied.status_code == 404
    assert denied.json()["code"] == 10004


@pytest.mark.asyncio
async def test_list_is_scoped_to_tenant(client):
    tenant_a = await _create_tenant(client, "tenant-scope-a")
    tenant_b = await _create_tenant(client, "tenant-scope-b")
    await _create_app(client, tenant_a, "A 的应用")

    resp = await client.get("/api/v1/apps", headers={"X-Tenant-Id": tenant_b})
    assert resp.json()["data"]["total"] == 0

    resp = await client.get("/api/v1/apps", headers={"X-Tenant-Id": tenant_a})
    assert resp.json()["data"]["total"] == 1


@pytest.mark.asyncio
async def test_chat_creates_conversation_and_can_continue(client):
    tenant = await _create_tenant(client, "tenant-chat")
    app_id = await _create_app(client, tenant, "对话应用")

    first = await client.post(
        f"/api/v1/apps/{app_id}/chat",
        json={"user_id": "u1", "message": "你好"},
        headers={"X-Tenant-Id": tenant, "X-App-Id": app_id},
    )
    assert first.status_code == 200, first.text
    data = first.json()["data"]
    assert data["status"] == "completed"
    conv_id = data["conversation_id"]

    second = await client.post(
        f"/api/v1/apps/{app_id}/chat",
        json={"user_id": "u1", "message": "再问一次", "conversation_id": conv_id},
        headers={"X-Tenant-Id": tenant, "X-App-Id": app_id},
    )
    assert second.status_code == 200
    assert second.json()["data"]["conversation_id"] == conv_id

    msgs = await client.get(
        f"/api/v1/conversations/{conv_id}/messages",
        headers={"X-Tenant-Id": tenant, "X-App-Id": app_id},
    )
    assert msgs.json()["data"]["total"] == 4  # 2 轮 × (user + assistant)


@pytest.mark.asyncio
async def test_conversation_user_mismatch_forbidden(client):
    tenant = await _create_tenant(client, "tenant-user")
    app_id = await _create_app(client, tenant, "用户隔离应用")
    headers = {"X-Tenant-Id": tenant, "X-App-Id": app_id}

    created = await client.post(
        f"/api/v1/apps/{app_id}/chat",
        json={"user_id": "alice", "message": "你好"},
        headers=headers,
    )
    conv_id = created.json()["data"]["conversation_id"]

    resp = await client.get(f"/api/v1/conversations/{conv_id}", headers=headers)
    # 无用户令牌时不做 user 校验，允许管理侧查看
    assert resp.status_code == 200

    # 模拟其他用户令牌
    from app.core.security import issue_token

    other = issue_token(subject="bob", tenant_id=tenant, app_id=app_id)
    denied = await client.get(
        f"/api/v1/conversations/{conv_id}",
        headers={**headers, "Authorization": f"Bearer {other}"},
    )
    assert denied.status_code == 403
    assert denied.json()["code"] == 10003


@pytest.mark.asyncio
async def test_missing_tenant_header_rejected(client):
    resp = await client.get("/api/v1/apps")
    assert resp.status_code == 400
    assert resp.json()["code"] == 10001


@pytest.mark.asyncio
async def test_tenant_mismatch_between_header_and_token(client):
    tenant_a = await _create_tenant(client, "tenant-tok-a")
    tenant_b = await _create_tenant(client, "tenant-tok-b")

    from app.core.security import issue_token

    token = issue_token(subject="u1", tenant_id=tenant_a)
    resp = await client.get(
        "/api/v1/apps",
        headers={"X-Tenant-Id": tenant_b, "Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == 10003
