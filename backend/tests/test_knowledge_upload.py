"""文件入库与资源删除的隔离、持久化回归。"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models import Chunk
from tests.test_api_m2 import TENANT_HEADER, _bootstrap


async def create_kb(client, headers, name="文件库"):
    response = await client.post("/api/v1/knowledge-bases", json={"name": name}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


@pytest.mark.parametrize("extension", ["txt", "md"])
async def test_upload_index_search_and_delete(client, session_factory, extension):
    tenant, _ = await _bootstrap(client)
    headers = {TENANT_HEADER: tenant}
    kb = await create_kb(client, headers)
    response = await client.post(
        f"/api/v1/knowledge-bases/{kb}/documents/upload", headers=headers,
        files={"file": (f"../policy.{extension}", "\ufeff七天无理由退货".encode(), "text/plain")},
    )
    assert response.status_code == 200, response.text
    doc = response.json()["data"]
    assert doc["status"] == "indexed"
    assert doc["source"] == f"policy.{extension}"
    assert doc["title"] == "policy"
    response = await client.post(
        f"/api/v1/knowledge-bases/{kb}/search", headers=headers,
        json={"query": "七天无理由退货"},
    )
    assert response.json()["data"]["hits"][0]["document_id"] == doc["id"]
    other_kb = await create_kb(client, headers, "另一库")
    response = await client.delete(
        f"/api/v1/knowledge-bases/{other_kb}/documents/{doc['id']}", headers=headers,
    )
    assert response.status_code == 404
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(Chunk)) > 0
    response = await client.delete(f"/api/v1/knowledge-bases/{kb}", headers=headers)
    assert response.status_code == 200
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(Chunk).where(
            Chunk.document_id == uuid.UUID(doc["id"])
        )) == 0


@pytest.mark.parametrize("name,content,status", [
    ("policy.pdf", b"fake pdf", 415),
    ("policy.txt", b"\xff", 422),
    ("policy.txt", b" \n", 422),
    ("policy.txt", b"text\x00binary", 422),
    ("policy.txt", b"a" * (2 * 1024 * 1024 + 1), 413),
])
async def test_invalid_upload_creates_no_document(client, name, content, status):
    tenant, _ = await _bootstrap(client)
    headers = {TENANT_HEADER: tenant}
    kb = await create_kb(client, headers)
    response = await client.post(
        f"/api/v1/knowledge-bases/{kb}/documents/upload", headers=headers,
        files={"file": (name, content)},
    )
    assert response.status_code == status, response.text
    response = await client.get(f"/api/v1/knowledge-bases/{kb}/documents", headers=headers)
    assert response.json()["data"]["total"] == 0


async def test_upload_rejects_other_tenant(client):
    tenant_a, _ = await _bootstrap(client, "upload-a")
    tenant_b, _ = await _bootstrap(client, "upload-b")
    kb = await create_kb(client, {TENANT_HEADER: tenant_a})
    response = await client.post(
        f"/api/v1/knowledge-bases/{kb}/documents/upload",
        headers={TENANT_HEADER: tenant_b}, files={"file": ("policy.txt", b"policy")},
    )
    assert response.status_code == 404
