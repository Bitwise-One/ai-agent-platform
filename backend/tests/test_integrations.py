"""M4 MCP/Skill 管理与 Agent 绑定契约。"""

import pytest

from app.services import integrations as integration_service


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


@pytest.mark.asyncio
async def test_mcp_discovery_registers_tools_for_agent_binding(client, monkeypatch):
    _, app, agent, headers = await bootstrap(client, "t-mcp-discovery")
    created = await client.post(
        "/api/v1/mcp-servers",
        json={"name": "工具服务", "transport": "http", "config": {"url": "https://tools.example.test/mcp"}},
        headers=headers,
    )
    mcp_id = created.json()["data"]["id"]

    discovered_tools = [
            {"name": "lookup", "description": "查询资料", "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}}},
            {"name": "summarize", "description": "摘要", "input_schema": {"type": "object"}},
        ]

    async def fake_fetch(_server):
        return discovered_tools

    monkeypatch.setattr(integration_service, "_fetch_mcp_tools", fake_fetch)
    discovered = await client.post(f"/api/v1/mcp-servers/{mcp_id}/discover", headers=headers)
    assert discovered.status_code == 200, discovered.text
    tools = discovered.json()["data"]["tools"]
    assert {tool["name"] for tool in tools} == {"lookup", "summarize"}

    bound = await client.put(
        f"/api/v1/apps/{app}/agents/{agent}/mcp-tools",
        json={"ids": [next(tool["id"] for tool in tools if tool["name"] == "lookup")]},
        headers=headers,
    )
    assert bound.status_code == 200, bound.text
    assert bound.json()["data"]["ids"] == [next(tool["id"] for tool in tools if tool["name"] == "lookup")]
    fetched = await client.get(f"/api/v1/apps/{app}/agents/{agent}/mcp-tools", headers=headers)
    assert fetched.json()["data"]["ids"] == bound.json()["data"]["ids"]

    discovered_tools.clear()
    await client.post(f"/api/v1/mcp-servers/{mcp_id}/discover", headers=headers)
    registered = await client.get(
        f"/api/v1/mcp-servers/{mcp_id}/tools?include_disabled=true", headers=headers
    )
    disabled = {tool["name"]: tool["enabled"] for tool in registered.json()["data"]["items"]}
    assert disabled == {"lookup": False, "summarize": False}


@pytest.mark.asyncio
async def test_stdio_discovery_is_delegated_to_worker(client):
    _, _, _, headers = await bootstrap(client, "t-mcp-stdio")
    created = await client.post(
        "/api/v1/mcp-servers",
        json={"name": "本地命令", "transport": "stdio", "config": {"command": "untrusted"}},
        headers=headers,
    )
    response = await client.post(f"/api/v1/mcp-servers/{created.json()['data']['id']}/discover", headers=headers)
    assert response.status_code == 409
