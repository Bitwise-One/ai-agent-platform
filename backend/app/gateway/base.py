"""模型网关抽象层（对应 design/model-gateway.md §2）。

设计目标：
1. 业务层（Agent/工作流）只面向「逻辑模型」，不直接依赖任何厂商 SDK；
2. 所有 provider 实现同一套 `complete` / `stream` 接口，可插拔替换；
3. 统一产出计量信息（tokens / 耗时），供成本统计与 trace 使用。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

# 统一的消息结构：{"role": "system|user|assistant|tool", "content": "..."}
Message = dict[str, str]


@dataclass
class LLMResponse:
    """一次非流式补全的完整结果。"""

    text: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    finish_reason: str = "stop"
    # 原始响应（调试用，禁止入库敏感字段）
    raw: dict = field(default_factory=dict)

    @property
    def tokens_total(self) -> int:
        return self.tokens_in + self.tokens_out


@dataclass
class LLMChunk:
    """流式补全中的一个增量片段。"""

    text: str
    model: str = ""
    tokens_out: int = 0


class LLMProvider(Protocol):
    """所有模型供应商适配器需实现的协议。"""

    name: str

    async def complete(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        **kwargs,
    ) -> LLMResponse: ...

    async def stream(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        **kwargs,
    ) -> AsyncIterator[LLMChunk]: ...


class EmbeddingProvider(Protocol):
    """向量化提供者：知识库入库与查询共用。"""

    name: str
    dim: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class ProviderError(Exception):
    """provider 调用失败。retriable 决定上层是否重试/降级。"""

    def __init__(self, message: str, *, retriable: bool = True):
        self.retriable = retriable
        super().__init__(message)
