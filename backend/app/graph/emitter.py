"""流式事件发射器（ContextVar 实现）。

为什么用 ContextVar：
- LangGraph 的节点函数必须是「同步返回状态」的普通协程，不能是生成器；
- 但节点内部调用的 LLM provider 需要逐 token 外推；
- 通过请求级 ContextVar 注入一个发射函数，provider 即可在不改变函数签名的前提下推送 token。

SSE 端点在调用图执行前 `set_emitter(...)`，并在 `finally` 中 `reset_emitter(...)`。
"""

from __future__ import annotations

import contextvars
from collections.abc import Callable

# 发射函数签名：接收一个事件字典，内部通常写入 asyncio.Queue
TokenEmitter = Callable[[dict], None]

_emitter_var: contextvars.ContextVar[TokenEmitter | None] = contextvars.ContextVar(
    "token_emitter", default=None
)


def set_emitter(emitter: TokenEmitter | None) -> contextvars.Token:
    """设置当前上下文的发射器，返回用于恢复的 token。"""
    return _emitter_var.set(emitter)


def reset_emitter(token: contextvars.Token) -> None:
    """恢复上一层的发射器，避免跨请求污染。"""
    _emitter_var.reset(token)


def has_emitter() -> bool:
    return _emitter_var.get() is not None


def emit(event: dict) -> None:
    """向外推送一个事件；无发射器时静默丢弃（非流式调用场景）。"""
    emitter = _emitter_var.get()
    if emitter is not None:
        try:
            emitter(event)
        except Exception:  # noqa: BLE001 - 发射失败不得影响主流程
            pass


def emit_token(text: str) -> None:
    """推送一段增量文本。"""
    if text:
        emit({"type": "token", "text": text})
