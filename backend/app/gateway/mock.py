"""离线 mock provider：未配置真实模型密钥时的兜底实现。

用途：
1. 本地开发与 CI 无需外网/密钥即可跑通全链路；
2. 作为模型降级链的最后一环——真实模型全部失败时仍能给出可解释回复，
   符合 PRD「结束态必达」与「可解释失败而非静默报错」的要求。
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import AsyncIterator

from app.gateway.base import LLMChunk, LLMResponse, Message

# 中英文按字符切分，用于构造伪向量
_TOKEN_RE = re.compile(r"[\w\u4e00-\u9fff]+")


def _tokens(text: str) -> list[str]:
    raw = _TOKEN_RE.findall(text.lower())
    # 中文再按单字与二元组切一次，提高相似度区分度
    grams: list[str] = []
    for token in raw:
        grams.append(token)
        if len(token) > 1:
            grams.extend(token[i : i + 2] for i in range(len(token) - 1))
    return grams


class MockEmbedding:
    """确定性哈希伪向量。

    同一文本永远得到同一向量；共享词项越多，余弦相似度越高。
    仅用于离线开发与单测，不具语义理解能力，生产必须切换真实 embedding。
    """

    name = "mock"
    dim: int

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(t) for t in texts]

    def _embed_one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for gram in _tokens(text):
            digest = hashlib.md5(gram.encode("utf-8")).digest()
            idx = int.from_bytes(digest[:4], "big") % self.dim
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vec[idx] += sign
        # L2 归一化，保证余弦相似度只与方向有关
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]
        return vec


class MockLLM:
    """模板回显型 LLM，用于离线兜底。"""

    name = "mock"

    def __init__(self, default_model: str = "mock-echo") -> None:
        self._default_model = default_model

    @staticmethod
    def _compose(messages: list[Message]) -> str:
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        user = next(
            (m["content"] for m in reversed(messages) if m["role"] == "user"), ""
        )
        # 工具消息里的上下文优先；RAG 检索结果则由 Agent 执行器注入到 system 中，
        # 用固定分隔符包裹。这里把两者都提取出来回显，使离线模式下也能肉眼验证
        # 「知识库确实被检索并送进了模型」，而不是只看到一个模板回复。
        context = next((m["content"] for m in messages if m["role"] == "tool"), "")
        if not context:
            context = MockLLM._extract_rag_block(system)

        parts = ["（离线模式）已收到你的请求。"]
        if context:
            parts.append(f"参考到的知识：\n{context[:400]}")
        parts.append(f"你说：{user}")
        if system:
            parts.append(f"（当前角色设定：{system[:60]}…）")
        return "\n".join(parts)

    @staticmethod
    def _extract_rag_block(system: str) -> str:
        """从 system 提示中截取 RAG 分隔符之间的参考资料。

        与 `app.graph.runners.llm` 中的包裹格式保持一致；找不到标记就返回空串，
        因此这段逻辑对不含知识库的对话完全无副作用。
        """
        start = system.find("<<<参考资料开始>>>")
        if start < 0:
            return ""
        end = system.find("<<<参考资料结束>>>", start)
        body = system[start + len("<<<参考资料开始>>>") : end if end > 0 else None]
        return body.strip()

    async def complete(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        **kwargs,
    ) -> LLMResponse:
        text = self._compose(messages)
        return LLMResponse(
            text=text,
            model=model or self._default_model,
            tokens_in=sum(len(m["content"]) for m in messages),
            tokens_out=len(text),
            latency_ms=0,
        )

    async def stream(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        **kwargs,
    ) -> AsyncIterator[LLMChunk]:
        text = self._compose(messages)
        # 按 8 字一片模拟流式
        for i in range(0, len(text), 8):
            yield LLMChunk(text=text[i : i + 8], model=model or self._default_model)
