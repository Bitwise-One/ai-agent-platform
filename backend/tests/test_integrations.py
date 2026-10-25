"""M4 MCP/Skill 管理与 Agent 绑定契约。"""

import pytest


async def bootstrap(client, slug: str):
    tenant = (await client.post("/api/v1/tenants", json={"name": slug, "slug": slug})).json()["data"]["id"]
    app = (await client.post("/api/v1/apps", json={"name": "工具应用"}, headers={"X-Tenant-Id": tenant})).json()["data"]["id"]
    headers = {"X-Tenant-Id": tenant}
    agent = (await client.post(f"/api/v1/apps/{app}/agents", json={"name": "工具 Agent"}, headers=headers)).json()["data"]["id"]
    return tenant, app, agent, headers


@pytest.mark.asyncio
async def test_mcp_and_skill_crud_and_agent_binding(client):
    tenant, app, agent, headers = await bootstrap(client, "t-m4")
    mcp = await client.post("/api/v1/mcp-servers", json={"name": "检索服务", "transport": "http", "config": {"url": "https://example.test/mcp"}}, headers=headers)
    assert mcp.status_code == 200, mcp.text
    mcp_id = mcp.json()["data"]["id"]
    skill = await client.post("/api/v1/skills", json={"name": "摘要", "params_schema": {"type": "object"}}, headers=headers)
    assert skill.status_code == 200, skill.text
    skill_id = skill.json()["data"]["id"]

    bound = await client.put(f"/api/v1/apps/{app}/agents/{agent}/mcp-servers", json={"ids": [mcp_id]}, headers=headers)
    assert bound.json()["data"]["ids"] == [mcp_id]
    bound = await client.put(f"/api/v1/apps/{app}/agents/{agent}/skills", json={"ids": [skill_id]}, headers=headers)
    assert bound.json()["data"]["ids"] == [skill_id]

    listed = await client.get("/api/v1/mcp-servers", headers=headers)
    assert listed.json()["data"]["total"] == 1
    assert (await client.get(f"/api/v1/apps/{app}/agents/{agent}/skills", headers=headers)).json()["data"]["ids"] == [skill_id]


@pytest.mark.asyncio
async def test_integrations_are_tenant_scoped(client):
    tenant_a, _, _, headers_a = await bootstrap(client, "t-m4-a")
    tenant_b, _, _, headers_b = await bootstrap(client, "t-m4-b")
    created = await client.post("/api/v1/skills", json={"name": "私有技能"}, headers=headers_a)
    skill_id = created.json()["data"]["id"]
    assert (await client.get(f"/api/v1/skills/{skill_id}", headers=headers_b)).status_code == 404
    assert tenant_a != tenant_b


@pytest.mark.asyncio
async def test_mcp_rejects_inline_credentials(client):
    _, _, _, headers = await bootstrap(client, "t-m4-secret")
    response = await client.post(
        "/api/v1/mcp-servers",
        json={"name": "带凭据服务", "transport": "http", "config": {"api_key": "plain-text"}},
        headers=headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_mcp_list_paginates_and_filters_status(client):
    _, _, _, headers = await bootstrap(client, "t-m4-page")
    for name in ("服务一", "服务二"):
        response = await client.post(
            "/api/v1/mcp-servers",
            json={"name": name, "transport": "http", "config": {}},
            headers=headers,
        )
        assert response.status_code == 200
    listed = await client.get("/api/v1/mcp-servers?page=2&page_size=1&status=active", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] == 2
    assert listed.json()["data"]["page"] == 2
    assert len(listed.json()["data"]["items"]) == 1
