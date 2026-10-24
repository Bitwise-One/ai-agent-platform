"""OpenAI 兼容协议适配器（httpx 直连，不绑定任何厂商 SDK）。

兼容范围：OpenAI / Azure OpenAI / vLLM / Ollama(OpenAI 模式) /
DeepSeek / 通义千问(兼容模式) 等所有实现 `/chat/completions` 的服务。
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator

import httpx

from app.gateway.base import (
    LLMChunk,
    LLMResponse,
    Message,
    ProviderError,
)

# 可重试的 HTTP 状态码：限流与服务端错误
_RETRIABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class OpenAICompatLLM:
    """OpenAI 兼容的对话补全实现。"""

    name = "openai_compatible"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        default_model: str,
        timeout_s: float = 60.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._default_model = default_model
        self._timeout = timeout_s

    # ------------------------------------------------------------------ 内部
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    @staticmethod
    def _raise_for_status(status: int, body: str) -> None:
        if status < 400:
            return
        # 429/5xx 属于临时性故障，上层可重试或降级；4xx 多为参数问题，重试无意义
        raise ProviderError(
            f"LLM HTTP {status}: {body[:300]}",
            retriable=status in _RETRIABLE_STATUS,
        )

    # ------------------------------------------------------------------ 补全
    async def complete(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        **kwargs,
    ) -> LLMResponse:
        payload = {
            "model": model or self._default_model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens

        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    self._url("/chat/completions"),
                    headers=self._headers(),
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            # 超时视为可重试：上层可降级到更快的模型
            raise ProviderError(f"LLM 超时: {exc}", retriable=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"LLM 网络错误: {exc}", retriable=True) from exc

        self._raise_for_status(resp.status_code, resp.text)
        data = resp.json()
        latency_ms = int((time.perf_counter() - started) * 1000)

        choices = data.get("choices") or [{}]
        text = (choices[0].get("message") or {}).get("content") or ""
        usage = data.get("usage") or {}
        return LLMResponse(
            text=text,
            model=data.get("model") or payload["model"],
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
            latency_ms=latency_ms,
            finish_reason=choices[0].get("finish_reason") or "stop",
            raw={"id": data.get("id")},
        )

    # ------------------------------------------------------------------ 流式
    async def stream(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        **kwargs,
    ) -> AsyncIterator[LLMChunk]:
        """按 SSE 逐块产出增量文本。

        注意：这是生成器函数，调用方必须 `async for` 消费。
        """
        payload = {
            "model": model or self._default_model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            async with client.stream(
                "POST",
                self._url("/chat/completions"),
                headers=self._headers(),
                json=payload,
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", "ignore")
                    self._raise_for_status(resp.status_code, body)

                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        yield LLMChunk(text=piece, model=chunk.get("model") or payload["model"])


class OpenAICompatEmbedding:
    """OpenAI 兼容的向量化实现。"""

    name = "openai_compatible"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        dim: int,
        timeout_s: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self.dim = dim
        self._timeout = timeout_s

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        payload = {"model": self._model, "input": texts}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    f"{self._base_url}/embeddings",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Embedding 超时: {exc}") from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Embedding 网络错误: {exc}") from exc

        if resp.status_code >= 400:
            raise ProviderError(
                f"Embedding HTTP {resp.status_code}: {resp.text[:200]}",
                retriable=resp.status_code in _RETRIABLE_STATUS,
            )

        data = resp.json()
        return [item["embedding"] for item in data.get("data", [])]
