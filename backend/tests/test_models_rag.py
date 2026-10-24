"""M2 模型配置接口与 RAG 端到端测试。

分两组：
1. 模型目录 CRUD —— 验证租户隔离与 Agent 引用校验；
2. RAG 全链路 —— 知识库入库 → 绑定到 Agent → 对话时检索并注入模型上下文。

第二组是本阶段最关键的一条断言：它证明「知识库真的参与了大模型推理」，
而不只是能检索出结果。
"""

import pytest

TENANT_HEADER = "X-Tenant-Id"


async def _bootstrap(client, slug: str) -> tuple[str, str]:
    resp = await client.post("/api/v1/tenants", json={"name": slug, "slug": slug})
    tenant = resp.json()["data"]["id"]
    resp = await client.post(
        "/api/v1/apps", json={"name": f"{slug}-app"}, headers={TENANT_HEADER: tenant}
    )
    return tenant, resp.json()["data"]["id"]


# --------------------------------------------------------------- 模型配置 CRUD
@pytest.mark.asyncio
async def test_model_config_crud(client):
    tenant, _ = await _bootstrap(client, "t-model")
    headers = {TENANT_HEADER: tenant}

    created = await client.post(
        "/api/v1/models",
        json={
            "name": "主力模型",
            "provider": "openai_compat",
            "model_name": "gpt-4o-mini",
            "context_len": 128000,
            "price_in": 0.00015,
            "price_out": 0.0006,
            "capabilities": {"function_call": True},
        },
        headers=headers,
    )
    assert created.status_code == 200, created.text
    record = created.json()["data"]
    assert record["model_name"] == "gpt-4o-mini"
    assert record["capabilities"] == {"function_call": True}

    listed = await client.get("/api/v1/models", headers=headers)
    assert listed.json()["data"]["total"] == 1

    patched = await client.patch(
        f"/api/v1/models/{record['id']}",
        json={"name": "备用模型", "status": "disabled"},
        headers=headers,
    )
    assert patched.json()["data"]["name"] == "备用模型"
    assert patched.json()["data"]["status"] == "disabled"

    deleted = await client.delete(f"/api/v1/models/{record['id']}", headers=headers)
    assert deleted.status_code == 200
    assert (await client.get("/api/v1/models", headers=headers)).json()["data"]["total"] == 0


@pytest.mark.asyncio
async def test_model_config_scoped_by_tenant(client):
    """跨租户访问必须 404（不暴露资源存在性）。"""
    tenant_a, _ = await _bootstrap(client, "t-model-a")
    tenant_b, _ = await _bootstrap(client, "t-model-b")

    created = await client.post(
        "/api/v1/models",
        json={"name": "A 的模型", "model_name": "gpt-4o-mini"},
        headers={TENANT_HEADER: tenant_a},
    )
    model_id = created.json()["data"]["id"]

    denied = await client.get(f"/api/v1/models/{model_id}", headers={TENANT_HEADER: tenant_b})
    assert denied.status_code == 404

    # B 试图把自己的 Agent 指向 A 的模型，也应被拒绝
    _, app_b = await _bootstrap(client, "t-model-b2")
    bad = await client.post(
        f"/api/v1/apps/{app_b}/agents",
        json={"name": "蹭额度", "model_config_id": model_id},
        headers={TENANT_HEADER: tenant_b},
    )
    assert bad.status_code == 404


@pytest.mark.asyncio
async def test_model_probe_returns_result(client):
    """探测接口在离线环境也应正常返回（mock 兜底），不能 500。"""
    tenant, _ = await _bootstrap(client, "t-probe")
    headers = {TENANT_HEADER: tenant}

    model_id = (
        await client.post(
            "/api/v1/models",
            json={"name": "探测模型", "model_name": "gpt-4o-mini"},
            headers=headers,
        )
    ).json()["data"]["id"]

    resp = await client.post(f"/api/v1/models/{model_id}/probe", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["model_name"] == "gpt-4o-mini"
    assert data["ok"] is True
    assert "latency_ms" in data
    # 本地测试未配置真实密钥，网关应处于未就绪状态
    assert data["ready"] is False


# --------------------------------------------------------------- RAG 端到端
@pytest.mark.asyncio
async def test_rag_context_injected_into_agent_reply(client):
    """知识库内容必须真的进入模型上下文，并可在回复中观察到。"""
    tenant, app_id = await _bootstrap(client, "t-rag")
    headers = {TENANT_HEADER: tenant}

    # 1) 建知识库并入库一条明确可识别的事实
    kb_id = (
        await client.post(
            "/api/v1/knowledge-bases",
            json={"name": "售后政策库"},
            headers=headers,
        )
    ).json()["data"]["id"]
    await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        json={
            "title": "退换货政策",
            "content": "本店支持七天无理由退货，退款在三个工作日内原路退回。",
        },
        headers=headers,
    )

    # 2) 建 Agent 并绑定知识库
    agent_id = (
        await client.post(
            f"/api/v1/apps/{app_id}/agents",
            json={
                "name": "售后助手",
                "system_prompt": "你是售后客服",
                "keywords": ["退货", "退款"],
                "is_default": True,
            },
            headers=headers,
        )
    ).json()["data"]["id"]
    bound = await client.put(
        f"/api/v1/apps/{app_id}/agents/{agent_id}/knowledge-bases",
        json={"kb_ids": [kb_id]},
        headers=headers,
    )
    assert bound.status_code == 200, bound.text

    # 绑定必须可回读：控制台编辑表单靠它回显，否则一保存就清空已有绑定
    echo = await client.get(
        f"/api/v1/apps/{app_id}/agents/{agent_id}/knowledge-bases", headers=headers
    )
    assert echo.status_code == 200, echo.text
    assert echo.json()["data"]["kb_ids"] == [kb_id]

    # 3) 对话：应触发检索，且模型上下文包含知识片段
    resp = await client.post(
        f"/api/v1/apps/{app_id}/chat",
        json={"user_id": "u1", "message": "你们支持七天无理由退货吗？"},
        headers={TENANT_HEADER: tenant, "X-App-Id": app_id},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]

    assert data["rag_sources"], "未产生检索来源，说明 RAG 未生效"
    assert "退换货政策" in data["rag_sources"][0]["title"]
    # 离线 mock 会把 system 中的参考资料回显，据此确认内容真的进了提示词
    assert "七天无理由退货" in data["reply"]
