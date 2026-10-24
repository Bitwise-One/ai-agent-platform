"""隐藏返回（Hidden Response）的提取与校验。

背景（PRD §4.10）：平台需要一类「不展示在聊天框、只给前端触发动作」的结构化返回。
落地做法：允许模型/工具输出如下受控片段，服务端在落库与下发前剥离：

    [[HIDDEN]]{"action": "open_form", "payload": {"form_id": "booking"}}[[/HIDDEN]]

安全约束（FR-H-05 / FR-SE-03）：
- 仅允许白名单内的 action，未知 action 一律丢弃并记录，防止模型诱导前端执行任意代码；
- payload 必须是 JSON 对象，且限制大小，避免注入大体积恶意内容；
- 剥离后的正文才是用户可见内容，保证聊天区不会被指令污染。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# 允许的隐藏动作白名单（与 PRD §4.10 action 枚举一致）
ALLOWED_ACTIONS = {
    "open_form",
    "navigate",
    "show_modal",
    "refresh_data",
    "render_chart",
    "call_function",
    "download_file",
    "custom",
}

# 单个 payload 的序列化上限，防止大对象拖垮链路
MAX_PAYLOAD_BYTES = 8 * 1024

_HIDDEN_RE = re.compile(r"\[\[HIDDEN\]\](.*?)\[\[/HIDDEN\]\]", re.DOTALL)


def extract_hidden(text: str) -> tuple[str, list[dict[str, Any]]]:
    """从模型输出中剥离隐藏返回片段。

    Args:
        text: 模型原始输出。

    Returns:
        (用户可见正文, 合法的隐藏返回列表)
    """
    if not text:
        return "", []

    hidden: list[dict[str, Any]] = []

    def _strip(match: re.Match[str]) -> str:
        raw = match.group(1).strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("隐藏返回不是合法 JSON，已丢弃: %.120s", raw)
            return ""

        if not isinstance(data, dict):
            logger.warning("隐藏返回必须是 JSON 对象，已丢弃")
            return ""

        action = str(data.get("action", "")).strip()
        if action not in ALLOWED_ACTIONS:
            logger.warning("隐藏返回 action 不在白名单，已丢弃: %s", action)
            return ""

        payload = data.get("payload") or {}
        if not isinstance(payload, dict):
            logger.warning("隐藏返回 payload 必须是对象，已丢弃")
            return ""

        if len(json.dumps(payload, ensure_ascii=False).encode()) > MAX_PAYLOAD_BYTES:
            logger.warning("隐藏返回 payload 超限，已丢弃: %s", action)
            return ""

        hidden.append({"action": action, "payload": payload})
        return ""

    clean = _HIDDEN_RE.sub(_strip, text)
    # 剥离后可能留下多余空行，做一次收敛
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    return clean, hidden


def build_hidden_hint(actions: list[str] | None = None) -> str:
    """生成注入 system prompt 的隐藏返回使用说明。

    只把允许的动作告诉模型，避免其臆造未定义动作。
    """
    allowed = [a for a in (actions or sorted(ALLOWED_ACTIONS)) if a in ALLOWED_ACTIONS]
    joined = ", ".join(allowed)
    return (
        "\n\n【隐藏返回能力】\n"
        "当你需要驱动前端界面行为（如打开表单、跳转页面、刷新数据）时，"
        "在回复末尾追加一段受控片段，前端不会展示它：\n"
        '[[HIDDEN]]{"action": "<动作>", "payload": { ... }}[[/HIDDEN]]\n'
        f"可用动作：{joined}。\n"
        "不要在普通文本中解释该片段的存在。"
    )
