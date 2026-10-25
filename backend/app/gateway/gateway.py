"""模型网关：统一入口 + 重试 + 降级链 + 计量。

对应 PRD FR-MG-01~08 与 design/model-gateway.md §4/§5/§9：
- 业务层只调用 `get_gateway()`，不感知具体厂商；
- 主模型失败按「重试 → 降级模型 → mock 兜底」逐级收敛，绝不向上抛死。
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from functools import lru_cache

from app.core.config import Settings, get_settings
from app.gateway.base import (
    EmbeddingProvider,
    LLMChunk,
    LLMProvider,
    LLMResponse,
    Message,
    ProviderError,
)
from app.gateway.mock import MockEmbedding, MockLLM
from app.gateway.openai_compat import OpenAICompatEmbedding, OpenAICompatLLM

logger = logging.getLogger(__name__)

# 重试参数：指数退避，避免瞬时故障放大成雪崩
_MAX_RETRIES = 2
_BACKOFF_BASE_S = 0.4


class ModelGateway:
    """统一模型网关。"""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._mock_llm = MockLLM()
        self._mock_embedding = MockEmbedding(self._settings.embedding_dim)

        # 主 LLM provider：只有配置齐全才启用真实模型
        self._llm: LLMProvider | None = None
        if self._settings.llm_ready and self._settings.llm_provider != "mock":
            self._llm = OpenAICompatLLM(
                base_url=self._settings.llm_base_url,
                api_key=self._settings.llm_api_key,
                default_model=self._settings.llm_model,
                timeout_s=self._settings.llm_timeout_s,
            )

        # 降级模型列表（逗号分隔）
        self._fallback_models = [
            m.strip() for m in (self._settings.llm_fallback_models or "").split(",") if m.strip()
        ]

        self._embedding: EmbeddingProvider | None = None
        if self._settings.embedding_ready:
            self._embedding = OpenAICompatEmbedding(
                base_url=self._settings.embedding_base_url,
                api_key=self._settings.embedding_api_key,
                model=self._settings.embedding_model,
                dim=self._settings.embedding_dim,
                timeout_s=self._settings.embedding_timeout_s,
            )

    # ------------------------------------------------------------------ 元信息
    @property
    def llm_ready(self) -> bool:
        """是否接入真实 LLM（否则走 mock 模板回显）。"""
        return self._llm is not None

    @property
    def embedding_ready(self) -> bool:
        return self._embedding is not None

    @property
    def embedding_dim(self) -> int:
        return self._embedding.dim if self._embedding else self._mock_embedding.dim

    # ------------------------------------------------------------------ 补全
    async def complete(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        tools: list[dict] | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> LLMResponse:
        """非流式补全，带重试与降级。"""
        temp = self._settings.llm_temperature if temperature is None else temperature
        tokens = max_tokens or self._settings.llm_max_tokens

        # 1) 无真实模型：直接 mock
        provider = self._provider_for(base_url, api_key)
        if provider is None:
            return await self._mock_llm.complete(messages, model=model, temperature=temp)

        # 2) 主模型 + 降级模型依次尝试
        candidates: list[str | None] = [model]
        candidates.extend(self._fallback_models)

        last_error: Exception | None = None
        for candidate in candidates:
            try:
                return await self._complete_with_retry(
                    provider,
                    messages,
                    model=candidate,
                    temperature=temp,
                    max_tokens=tokens,
                    tools=tools,
                )
            except ProviderError as exc:
                last_error = exc
                if not exc.retriable:
                    # 参数类错误重试/降级都无意义，直接兜底 mock
                    logger.warning("LLM 不可重试错误，转 mock 兜底: %s", exc)
                    break
                logger.warning("LLM 调用失败，尝试下一候选 model=%s: %s", candidate, exc)

        if (base_url is not None or api_key is not None) and last_error is not None:
            raise last_error

        # 3) 最终兜底：mock，保证调用方永远拿到结果
        logger.error("所有 LLM 候选均失败，使用 mock 兜底。最后错误: %s", last_error)
        return await self._mock_llm.complete(messages, model=model, temperature=temp)

    def _provider_for(self, base_url: str | None, api_key: str | None) -> LLMProvider | None:
        if base_url is None and api_key is None:
            return self._llm
        resolved_url = base_url or self._settings.llm_base_url
        resolved_key = api_key or self._settings.llm_api_key
        if not resolved_url or not resolved_key:
            return None
        return OpenAICompatLLM(
            base_url=resolved_url,
            api_key=resolved_key,
            default_model=self._settings.llm_model,
            timeout_s=self._settings.llm_timeout_s,
        )

    async def _complete_with_retry(
        self,
        provider: LLMProvider,
        messages: list[Message],
        *,
        model: str | None,
        temperature: float,
        max_tokens: int,
        tools: list[dict] | None = None,
    ) -> LLMResponse:
        """指数退避重试：仅对可重试错误生效。"""
        attempt = 0
        while True:
            try:
                return await provider.complete(
                    messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    tools=tools,
                )
            except ProviderError as exc:
                if not exc.retriable or attempt >= _MAX_RETRIES:
                    raise
                delay = _BACKOFF_BASE_S * (2**attempt)
                logger.info("LLM 第 %s 次重试，等待 %.1fs", attempt + 1, delay)
                await asyncio.sleep(delay)
                attempt += 1

    # ------------------------------------------------------------------ 流式
    async def stream(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> AsyncIterator[LLMChunk]:
        """流式补全。

        注意：流式一旦开始产出就无法回退重试，因此降级只发生在「首个 chunk 之前」。
        """
        temp = self._settings.llm_temperature if temperature is None else temperature
        tokens = max_tokens or self._settings.llm_max_tokens

        provider = self._provider_for(base_url, api_key)
        if provider is None:
            async for chunk in self._mock_llm.stream(messages, model=model, temperature=temp):
                yield chunk
            return

        started = False
        try:
            async for chunk in provider.stream(
                messages, model=model, temperature=temp, max_tokens=tokens
            ):
                started = True
                yield chunk
            return
        except ProviderError as exc:
            if started:
                # 已产出部分内容，无法安全重来：记录并结束当前流
                logger.error("流式中途失败，已终止: %s", exc)
                return
            if base_url is not None or api_key is not None:
                raise
            logger.warning("流式首包前失败，转 mock 兜底: %s", exc)

        async for chunk in self._mock_llm.stream(messages, model=model, temperature=temp):
            yield chunk

    # ------------------------------------------------------------------ 向量
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """文本向量化；真实服务不可用时回落确定性伪向量。"""
        if not texts:
            return []
        if self._embedding is None:
            return await self._mock_embedding.embed(texts)

        try:
            return await self._embedding.embed(texts)
        except ProviderError as exc:
            logger.warning("Embedding 调用失败，回落伪向量: %s", exc)
            return await self._mock_embedding.embed(texts)

    # ------------------------------------------------------------------ 计量
    @staticmethod
    def estimate_cost(tokens_in: int, tokens_out: int, price_in: float, price_out: float) -> float:
        """按每 1K token 单价估算成本（单位与 model_config 一致）。"""
        cost = tokens_in / 1000 * price_in + tokens_out / 1000 * price_out
        return round(cost, 6)

    @staticmethod
    def now_ms() -> int:
        return int(time.perf_counter() * 1000)


@lru_cache
def get_gateway() -> ModelGateway:
    """进程级单例，避免每次请求重建 httpx 客户端配置。"""
    return ModelGateway()
