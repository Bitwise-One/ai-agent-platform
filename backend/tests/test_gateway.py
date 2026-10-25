"""模型网关与隐藏返回的单测（离线，无需外部服务）。"""

import pytest

from app.gateway import ModelGateway
from app.gateway.base import ProviderError
from app.gateway.mock import MockEmbedding, MockLLM
from app.graph.hidden import ALLOWED_ACTIONS, extract_hidden


@pytest.mark.asyncio
async def test_mock_llm_echoes_user_input():
    resp = await MockLLM().complete([
        {"role": "system", "content": "你是助手"},
        {"role": "user", "content": "你好"},
    ])
    assert "你好" in resp.text


@pytest.mark.asyncio
async def test_mock_embedding_is_deterministic_and_normalized():
    emb = MockEmbedding(dim=64)
    a1 = (await emb.embed(["合同条款审查"]))[0]
    a2 = (await emb.embed(["合同条款审查"]))[0]
    assert a1 == a2
    assert len(a1) == 64
    norm = sum(v * v for v in a1) ** 0.5
    assert abs(norm - 1.0) < 1e-6


@pytest.mark.asyncio
async def test_mock_embedding_similar_text_scores_higher():
    from app.knowledge.retriever import cosine_similarity

    emb = MockEmbedding(dim=128)
    base, similar, different = await emb.embed(
        ["合同条款需要审查", "合同条款审查要点", "今天天气很好"]
    )
    assert cosine_similarity(base, similar) > cosine_similarity(base, different)


@pytest.mark.asyncio
async def test_gateway_falls_back_to_mock_when_not_ready():
    gateway = ModelGateway()
    assert gateway.llm_ready is False
    resp = await gateway.complete([{"role": "user", "content": "你好"}])
    assert resp.text


@pytest.mark.asyncio
async def test_gateway_stream_yields_chunks():
    gateway = ModelGateway()
    pieces = [c.text async for c in gateway.stream([{"role": "user", "content": "你好呀"}])]
    assert len(pieces) >= 1
    assert "你好呀" in "".join(pieces)


@pytest.mark.asyncio
async def test_gateway_falls_back_on_provider_error(monkeypatch):
    """主模型抛可重试错误时，应降级到 mock 而不是把异常抛给业务层。"""

    class BoomProvider:
        name = "boom"

        async def complete(self, *args, **kwargs):
            raise ProviderError("boom", retriable=True)

        async def stream(self, *args, **kwargs):
            raise ProviderError("boom", retriable=True)
            yield  # pragma: no cover

    gateway = ModelGateway()
    gateway._llm = BoomProvider()  # noqa: SLF001 - 单测直接注入
    monkeypatch.setattr("app.gateway.gateway._BACKOFF_BASE_S", 0.0)

    resp = await gateway.complete([{"role": "user", "content": "降级测试"}])
    assert "降级测试" in resp.text


@pytest.mark.asyncio
async def test_gateway_passes_tools_to_provider_and_returns_tool_calls():
    from app.gateway.base import LLMResponse

    class ToolProvider:
        name = "tool-provider"

        async def complete(self, messages, **kwargs):
            assert kwargs["tools"][0]["function"]["name"] == "lookup"
            return LLMResponse(
                text="",
                model="tool-model",
                tool_calls=[{"id": "call-1", "name": "lookup", "arguments": "{}"}],
            )

        async def stream(self, *args, **kwargs):
            yield

    gateway = ModelGateway()
    gateway._llm = ToolProvider()  # noqa: SLF001
    result = await gateway.complete(
        [{"role": "user", "content": "lookup"}],
        tools=[{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}],
    )
    assert result.tool_calls[0]["name"] == "lookup"


def test_extract_hidden_strips_block():
    raw = '这是正文。[[HIDDEN]]{"action": "open_form", "payload": {"form_id": "f1"}}[[/HIDDEN]]'
    clean, hidden = extract_hidden(raw)
    assert clean == "这是正文。"
    assert hidden == [{"action": "open_form", "payload": {"form_id": "f1"}}]


def test_extract_hidden_rejects_unknown_action():
    raw = '正文[[HIDDEN]]{"action": "rm_rf_root", "payload": {}}[[/HIDDEN]]'
    clean, hidden = extract_hidden(raw)
    assert clean == "正文"
    assert hidden == []
    assert "rm_rf_root" not in ALLOWED_ACTIONS


def test_extract_hidden_rejects_invalid_json():
    raw = "正文[[HIDDEN]]not-json[[/HIDDEN]]"
    clean, hidden = extract_hidden(raw)
    assert clean == "正文"
    assert hidden == []


def test_extract_hidden_rejects_oversized_payload():
    big = "x" * 9000
    raw = f'正文[[HIDDEN]]{{"action": "custom", "payload": {{"d": "{big}"}}}}[[/HIDDEN]]'
    _, hidden = extract_hidden(raw)
    assert hidden == []


def test_extract_hidden_without_block_is_noop():
    clean, hidden = extract_hidden("普通回复")
    assert clean == "普通回复"
    assert hidden == []
