"""M4 MCP/Skill 管理与 Agent 绑定契约。"""

import base64

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


@pytest.mark.asyncio
async def test_skill_instructions_are_registered_and_triggered_per_agent(client):
    from app.graph.runners.llm import _active_skill_instructions
    from app.graph.state import AgentState

    _, app, agent, headers = await bootstrap(client, "t-skill-runtime")
    created = await client.post(
        "/api/v1/skills",
        json={
            "name": "订单查询",
            "description": "查询订单状态",
            "instructions": "先确认订单号，再总结查询结果。",
            "trigger": {"keywords": ["订单"]},
        },
        headers=headers,
    )
    assert created.status_code == 200, created.text
    skill = created.json()["data"]
    assert skill["instructions"] == "先确认订单号，再总结查询结果。"
    bound = await client.put(
        f"/api/v1/apps/{app}/agents/{agent}/skills",
        json={"ids": [skill["id"]]},
        headers=headers,
    )
    assert bound.status_code == 200

    state = AgentState(
        user_input="帮我查订单状态",
        skills_by_agent={agent: [{"name": skill["name"], "instructions": skill["instructions"], "trigger": skill["trigger"]}]},
    )
    assert "先确认订单号" in _active_skill_instructions(agent, state)
    state["user_input"] = "今天天气如何"
    assert _active_skill_instructions(agent, state) == ""
    assert _active_skill_instructions("different-agent", state) == ""


@pytest.mark.asyncio
async def test_wasm_skill_invocation_is_bounded_and_tenant_scoped(client):
    import wasmtime

    _, _, _, headers = await bootstrap(client, "t-wasm-skill")
    wat = r'''(module
      (memory (export "memory") 1)
      (func (export "alloc") (param i32) (result i32) i32.const 100)
      (func (export "run") (param i32 i32) (result i64) i64.const 68719476747)
      (data (i32.const 16) "{\"ok\":true}"))'''
    module_b64 = base64.b64encode(wasmtime.wat2wasm(wat)).decode("ascii")
    created = await client.post(
        "/api/v1/skills",
        json={
            "name": "计算 Skill",
            "params_schema": {"type": "object", "required": ["count"], "properties": {"count": {"type": "integer"}}},
            "wasm_module_base64": module_b64,
        },
        headers=headers,
    )
    assert created.status_code == 200, created.text
    assert "wasm_module_base64" not in created.json()["data"]
    skill_id = created.json()["data"]["id"]
    invoked = await client.post(f"/api/v1/skills/{skill_id}/invoke", json={"params": {"count": 2}}, headers=headers)
    assert invoked.status_code == 200, invoked.text
    assert invoked.json()["data"]["result"] == {"ok": True}
    invalid = await client.post(f"/api/v1/skills/{skill_id}/invoke", json={"params": {}}, headers=headers)
    assert invalid.status_code == 422

    other = await client.post("/api/v1/tenants", json={"name": "other", "slug": "t-wasm-other"})
    denied = await client.post(
        f"/api/v1/skills/{skill_id}/invoke",
        json={"params": {"count": 2}},
        headers={"X-Tenant-Id": other.json()["data"]["id"]},
    )
    assert denied.status_code == 404


@pytest.mark.asyncio
async def test_wasm_skill_rejects_host_imports(client):
    import wasmtime

    _, _, _, headers = await bootstrap(client, "t-wasm-import")
    module_b64 = base64.b64encode(wasmtime.wat2wasm('(module (import "host" "open" (func)))')).decode("ascii")
    created = await client.post(
        "/api/v1/skills",
        json={"name": "导入模块", "wasm_module_base64": module_b64},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    response = await client.post(
        f"/api/v1/skills/{created.json()['data']['id']}/invoke",
        json={"params": {}},
        headers=headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_wasm_skill_fuel_limit_stops_nonterminating_module(client):
    import wasmtime

    _, _, _, headers = await bootstrap(client, "t-wasm-fuel")
    wat = '''(module
      (memory (export "memory") 1)
      (func (export "alloc") (param i32) (result i32) i32.const 100)
      (func (export "run") (param i32 i32) (result i64)
        (loop $forever (br $forever))
        i64.const 0))'''
    module_b64 = base64.b64encode(wasmtime.wat2wasm(wat)).decode("ascii")
    created = await client.post(
        "/api/v1/skills", json={"name": "无限循环", "wasm_module_base64": module_b64}, headers=headers
    )
    assert created.status_code == 200, created.text
    response = await client.post(
        f"/api/v1/skills/{created.json()['data']['id']}/invoke",
        json={"params": {}},
        headers=headers,
    )
    assert response.status_code == 422
