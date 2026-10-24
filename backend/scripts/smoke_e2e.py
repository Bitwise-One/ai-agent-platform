"""后端联调冒烟脚本：走真实 HTTP，把 M1+M2 主链路串一遍。

为什么要有它：单测跑的是 ASGI 直连 + 内存库，绕过了 uvicorn、真实 SQLite、
真实请求头解析。上线前最常出问题的地方（CORS、路径、序列化、迁移与 ORM 不一致）
恰好都在这层，所以用真实服务再验一次。

输出直接写 UTF-8 文件，避免 PowerShell 把中文按 GBK 解码后显示成乱码。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parent / "_smoke_result.txt"
lines: list[str] = []
failures: list[str] = []


def step(title: str) -> None:
    lines.append(f"\n## {title}")


def ok(msg: str) -> None:
    lines.append(f"  PASS  {msg}")


def fail(msg: str) -> None:
    lines.append(f"  FAIL  {msg}")
    failures.append(msg)


def main() -> int:
    client = httpx.Client(base_url=BASE, timeout=30.0)

    # 1) 健康检查
    step("健康检查")
    r = client.get("/health")
    lines.append(f"  GET /health -> {r.status_code} {r.text[:120]}")
    if r.status_code != 200:
        fail("健康检查失败，服务未启动")
        return report()

    # 2) 建租户（slug 带时间戳，避免重复运行冲突）
    step("创建租户")
    import time

    slug = f"smoke-{int(time.time())}"
    r = client.post("/api/v1/tenants", json={"name": "冒烟租户", "slug": slug})
    if r.status_code != 200:
        fail(f"建租户失败: {r.status_code} {r.text[:200]}")
        return report()
    tenant_id = r.json()["data"]["id"]
    ok(f"tenant_id={tenant_id}")
    headers = {"X-Tenant-Id": tenant_id}

    # 3) 建应用
    step("创建应用")
    r = client.post("/api/v1/apps", json={"name": "冒烟应用"}, headers=headers)
    if r.status_code != 200:
        fail(f"建应用失败: {r.status_code} {r.text[:200]}")
        return report()
    app_id = r.json()["data"]["id"]
    ok(f"app_id={app_id}")

    # 4) 模型目录 + 探测
    step("模型目录")
    r = client.post(
        "/api/v1/models",
        json={"name": "冒烟模型", "model_name": "gpt-4o-mini", "price_in": 0.00015},
        headers=headers,
    )
    if r.status_code != 200:
        fail(f"建模型失败: {r.status_code} {r.text[:200]}")
    else:
        model_id = r.json()["data"]["id"]
        ok(f"model_id={model_id}")
        p = client.post(f"/api/v1/models/{model_id}/probe", headers=headers)
        data = p.json()["data"]
        ok(f"probe ok={data['ok']} ready={data['ready']} {data['latency_ms']}ms")

    # 5) Agent（引用模型 + 关键词路由）
    step("创建 Agent")
    agent_payload = {
        "name": "售后助手",
        "system_prompt": "你是电商售后客服，回答要简洁。",
        "keywords": ["退货", "退款"],
        "is_default": True,
    }
    if r.status_code == 200:
        agent_payload["model_config_id"] = model_id
    r = client.post(f"/api/v1/apps/{app_id}/agents", json=agent_payload, headers=headers)
    if r.status_code != 200:
        fail(f"建 Agent 失败: {r.status_code} {r.text[:200]}")
        return report()
    agent_id = r.json()["data"]["id"]
    ok(f"agent_id={agent_id} model_config_id={r.json()['data'].get('model_config_id')}")

    # 6) 知识库 + 文档入库
    step("知识库入库")
    kb_id = client.post(
        "/api/v1/knowledge-bases", json={"name": "售后政策库"}, headers=headers
    ).json()["data"]["id"]
    doc = client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        json={
            "title": "退换货政策",
            "content": "本店支持七天无理由退货，退款在三个工作日内原路退回。",
        },
        headers=headers,
    )
    ok(f"kb_id={kb_id} doc_status={doc.json()['data']['status']}")

    # 7) 绑定知识库到 Agent
    step("绑定知识库")
    b = client.put(
        f"/api/v1/apps/{app_id}/agents/{agent_id}/knowledge-bases",
        json={"kb_ids": [kb_id]},
        headers=headers,
    )
    if b.status_code == 200:
        ok(f"已绑定 {len(b.json()['data']['kb_ids'])} 个知识库")
    else:
        fail(f"绑定失败: {b.status_code} {b.text[:200]}")

    # 8) 工作流 + 编排图 + 发布
    step("工作流编排")
    wf_id = client.post(
        f"/api/v1/apps/{app_id}/workflows",
        json={"name": "主流程", "description": "冒烟用"},
        headers=headers,
    ).json()["data"]["id"]
    graph = {
        "nodes": [
            {"id": "router", "type": "router", "label": "智能路由", "position": {"x": 80, "y": 120}},
            {
                "id": agent_id,
                "type": "agent",
                "label": "售后助手",
                "position": {"x": 380, "y": 120},
            },
        ],
        "edges": [{"source": "router", "target": agent_id}],
        "router": "hybrid",
        "default_agent": agent_id,
        "rag_enabled": True,
    }
    g = client.put(f"/api/v1/apps/{app_id}/workflows/{wf_id}/graph", json=graph, headers=headers)
    ok(f"graph saved nodes={len(g.json()['data']['nodes'])} router={g.json()['data']['router']}")

    ver = client.post(
        f"/api/v1/apps/{app_id}/workflows/{wf_id}/versions",
        json={"changelog": "冒烟版本"},
        headers=headers,
    )
    version_id = ver.json()["data"]["id"]
    rel = client.post(
        f"/api/v1/apps/{app_id}/workflows/{wf_id}/release",
        json={"version_id": version_id},
        headers=headers,
    )
    ok(f"version={ver.json()['data']['version']} release={rel.status_code}")

    # 9) 非流式对话（验证 路由 + RAG + 模型网关 三件套同时生效）
    step("对话（非流式）")
    chat = client.post(
        f"/api/v1/apps/{app_id}/chat",
        json={"user_id": "u-smoke", "message": "你们支持七天无理由退货吗？"},
        headers={**headers, "X-App-Id": app_id},
    )
    if chat.status_code != 200:
        fail(f"对话失败: {chat.status_code} {chat.text[:300]}")
        return report()
    data = chat.json()["data"]
    lines.append(f"  status={data['status']} tokens={data['token_usage']}")
    lines.append(f"  reply={data['reply'][:160]!r}")
    lines.append(f"  rag_sources={json.dumps(data.get('rag_sources'), ensure_ascii=False)[:200]}")
    if data["status"] in {"completed", "degraded"}:
        ok("对话收敛到终态")
    else:
        fail(f"对话未收敛: {data['status']}")
    if data.get("rag_sources"):
        ok("RAG 命中知识库")
    else:
        fail("RAG 未命中")

    # 10) SSE 流式对话
    step("对话（SSE 流式）")
    events: list[str] = []
    with client.stream(
        "POST",
        f"/api/v1/apps/{app_id}/chat/stream",
        json={"user_id": "u-smoke", "message": "退款几天到账？"},
        headers={**headers, "X-App-Id": app_id},
    ) as resp:
        lines.append(f"  HTTP {resp.status_code} {resp.headers.get('content-type')}")
        for line in resp.iter_lines():
            if line.startswith("event:"):
                events.append(line.split(":", 1)[1].strip())
    lines.append(f"  events={events}")
    for required in ("meta", "token", "done"):
        if required in events:
            ok(f"收到 {required} 事件")
        else:
            fail(f"缺少 {required} 事件")

    # 11) 跨租户隔离
    step("跨租户隔离")
    other = client.post("/api/v1/tenants", json={"name": "另一个租户", "slug": f"{slug}-b"})
    other_id = other.json()["data"]["id"]
    cross = client.get(f"/api/v1/models/{model_id}", headers={"X-Tenant-Id": other_id})
    lines.append(f"  跨租户读模型 -> {cross.status_code}")
    if cross.status_code == 404:
        ok("跨租户返回 404（不泄漏存在性）")
    else:
        fail(f"跨租户隔离失效: {cross.status_code}")

    return report()


def report() -> int:
    lines.append("\n=== 汇总 ===")
    lines.append(f"失败项: {len(failures)}")
    for item in failures:
        lines.append(f"  - {item}")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
