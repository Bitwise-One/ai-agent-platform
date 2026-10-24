"""演示数据播种：给管理台准备一个「打开即有内容」的租户。

为什么不复用冒烟脚本：冒烟每次新建租户，数据越积越乱；演示数据要求
**幂等**——重复执行不会产生第二套租户/应用/工作流，方便反复调试前端。

幂等策略：
- 租户按 slug 去重（列表接口没有按 slug 查询的能力，这里取回来内存匹配）；
- 应用/Agent/知识库/工作流按名称去重，已存在则跳过创建；
- 编排图每次都整体覆盖，保证改完脚本重跑就能看到最新画布。
"""

from __future__ import annotations

import sys

import httpx

BASE = "http://127.0.0.1:8000"
SLUG = "demo"
TENANT_NAME = "演示租户"


def _ensure_tenant(client: httpx.Client) -> str:
    """按 slug 找租户，找不到就建。返回 tenant_id。"""
    resp = client.get("/api/v1/tenants", params={"page_size": 200})
    resp.raise_for_status()
    for item in resp.json()["data"]["items"]:
        if item["slug"] == SLUG:
            return item["id"]
    created = client.post("/api/v1/tenants", json={"name": TENANT_NAME, "slug": SLUG})
    created.raise_for_status()
    return created.json()["data"]["id"]


def _ensure_app(client: httpx.Client, headers: dict[str, str]) -> str:
    resp = client.get("/api/v1/apps", headers=headers, params={"page_size": 100})
    resp.raise_for_status()
    for item in resp.json()["data"]["items"]:
        if item["name"] == "智能客服":
            return item["id"]
    created = client.post(
        "/api/v1/apps",
        json={"name": "智能客服", "description": "面向电商售后场景的多 Agent 应用"},
        headers=headers,
    )
    created.raise_for_status()
    return created.json()["data"]["id"]


def main() -> int:
    client = httpx.Client(base_url=BASE, timeout=60.0)
    health = client.get("/health")
    if health.status_code != 200:
        print("后端未启动，先运行 uvicorn", file=sys.stderr)
        return 1

    tenant_id = _ensure_tenant(client)
    headers = {"X-Tenant-Id": tenant_id}
    app_id = _ensure_app(client, headers)
    print(f"tenant={tenant_id}\napp={app_id}")

    # ---- 模型目录 ----
    models = client.get("/api/v1/models", headers=headers).json()["data"]["items"]
    if not models:
        for payload in (
            {
                "name": "主力模型",
                "provider": "openai_compat",
                "model_name": "gpt-4o-mini",
                "context_len": 128000,
                "price_in": 0.00015,
                "price_out": 0.0006,
                "capabilities": {"function_call": True, "stream": True},
            },
            {
                "name": "轻量模型",
                "provider": "openai_compat",
                "model_name": "gpt-4o-nano",
                "context_len": 32000,
                "price_in": 0.00005,
                "price_out": 0.0002,
                "capabilities": {"stream": True},
            },
        ):
            client.post("/api/v1/models", json=payload, headers=headers).raise_for_status()
        models = client.get("/api/v1/models", headers=headers).json()["data"]["items"]
    model_id = models[0]["id"]
    print(f"models={len(models)}")

    # ---- 知识库 + 文档 ----
    kbs = client.get("/api/v1/knowledge-bases", headers=headers).json()["data"]["items"]
    kb = next((k for k in kbs if k["name"] == "售后政策库"), None)
    if kb is None:
        kb = client.post(
            "/api/v1/knowledge-bases",
            json={"name": "售后政策库", "description": "退换货、退款时效、发票规则"},
            headers=headers,
        ).json()["data"]
        documents = [
            (
                "退换货政策",
                "本店支持七天无理由退货。商品需保持完好、包装齐全、不影响二次销售。"
                "定制类商品与生鲜食品不支持无理由退货。",
            ),
            (
                "退款时效",
                "退货签收后 1 个工作日内完成质检，质检通过后 3 个工作日内原路退款。"
                "银行卡退款到账时间以银行处理为准，通常为 1-7 个工作日。",
            ),
            (
                "发票规则",
                "支持开具电子普通发票与增值税专用发票。电子发票在订单完成后 24 小时内推送至预留邮箱。",
            ),
        ]
        for title, content in documents:
            client.post(
                f"/api/v1/knowledge-bases/{kb['id']}/documents",
                json={"title": title, "content": content},
                headers=headers,
            ).raise_for_status()
    print(f"kb={kb['id']}")

    # ---- Agent ----
    agents = client.get(f"/api/v1/apps/{app_id}/agents", headers=headers).json()["data"]["items"]
    if not agents:
        specs = [
            {
                "name": "售后助手",
                "system_prompt": "你是电商售后客服，回答简洁、准确，优先引用知识库中的政策。",
                "keywords": ["退货", "退款", "换货", "售后"],
                "temperature": 0.3,
                "is_default": True,
                "model_config_id": model_id,
            },
            {
                "name": "发票助手",
                "system_prompt": "你负责解答发票相关咨询，包括开票类型、时效与修改。",
                "keywords": ["发票", "开票", "税号", "报销"],
                "temperature": 0.2,
            },
            {
                "name": "通用助手",
                "system_prompt": "你是通用客服助手，礼貌回答用户问题。",
                "keywords": [],
                "temperature": 0.7,
            },
        ]
        for spec in specs:
            client.post(f"/api/v1/apps/{app_id}/agents", json=spec, headers=headers).raise_for_status()
        agents = client.get(f"/api/v1/apps/{app_id}/agents", headers=headers).json()["data"]["items"]

    # 全部 Agent 绑定知识库（发票助手也查同一份政策）
    for agent in agents:
        client.put(
            f"/api/v1/apps/{app_id}/agents/{agent['id']}/knowledge-bases",
            json={"kb_ids": [kb["id"]]},
            headers=headers,
        ).raise_for_status()
    print(f"agents={len(agents)}")

    # ---- 工作流 + 编排图 ----
    flows = client.get(f"/api/v1/apps/{app_id}/workflows", headers=headers).json()["data"]["items"]
    flow = next((f for f in flows if f["name"] == "主流程"), None)
    if flow is None:
        flow = client.post(
            f"/api/v1/apps/{app_id}/workflows",
            json={"name": "主流程", "description": "路由 + 三个业务 Agent 的默认编排"},
            headers=headers,
        ).json()["data"]

    by_name = {a["name"]: a for a in agents}
    # 画布坐标按「左路由、右三列」排布，前端打开即是可读的图
    nodes = [
        {"id": "router", "type": "router", "label": "智能路由", "position": {"x": 72, "y": 208}},
    ]
    for idx, name in enumerate(("售后助手", "发票助手", "通用助手")):
        if name in by_name:
            nodes.append(
                {
                    "id": by_name[name]["id"],
                    "type": "agent",
                    "label": name,
                    "position": {"x": 400, "y": 96 + idx * 148},
                }
            )
    edges = [
        {"source": "router", "target": node["id"], "label": node["label"]}
        for node in nodes[1:]
    ]
    graph = {
        "nodes": nodes,
        "edges": edges,
        "router": "hybrid",
        "default_agent": by_name.get("通用助手", {}).get("id"),
        "max_iterations": 8,
        "confidence_threshold": 0.55,
        "rag_enabled": True,
        "rag_top_k": 3,
    }
    client.put(
        f"/api/v1/apps/{app_id}/workflows/{flow['id']}/graph", json=graph, headers=headers
    ).raise_for_status()

    versions = client.get(
        f"/api/v1/apps/{app_id}/workflows/{flow['id']}/versions", headers=headers
    ).json()["data"]["items"]
    if not versions:
        version = client.post(
            f"/api/v1/apps/{app_id}/workflows/{flow['id']}/versions",
            json={"changelog": "初始版本：路由 + 3 Agent"},
            headers=headers,
        ).json()["data"]
        client.post(
            f"/api/v1/apps/{app_id}/workflows/{flow['id']}/release",
            json={"version_id": version["id"]},
            headers=headers,
        ).raise_for_status()

    print(f"workflow={flow['id']} nodes={len(nodes)}")
    print("\n=== 演示数据就绪 ===")
    print(f"X-Tenant-Id: {tenant_id}")
    print(f"X-App-Id: {app_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
