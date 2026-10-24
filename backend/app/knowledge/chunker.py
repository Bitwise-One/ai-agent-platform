"""文本切分：把长文档拆成可检索的块。

为什么不按固定字符硬切：
- 硬切会把一句话拦腰截断，检索命中后上下文语义残缺；
- 这里优先在「段落 → 句子 → 字符」三级边界回退，尽量保持语义完整。

同时用 overlap 保留相邻块的少量重叠，避免答案正好落在切口处被撕裂。
"""

from __future__ import annotations

import re

# 句子级分隔：中文句号/问号/叹号/分号，英文对应标点 + 换行
_SENTENCE_SPLIT = re.compile(r"(?<=[。！？；!?;])\s*|\n+")


def normalize(text: str) -> str:
    """统一空白：折叠多空格、去首尾、压缩连续空行。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_text(text: str, chunk_size: int = 500, overlap: int = 80) -> list[str]:
    """把文本切成大小接近 chunk_size 的块。

    Args:
        text: 原始文本。
        chunk_size: 单块目标字符数（下限 50）。
        overlap: 相邻块重叠字符数（不得超过 chunk_size 的一半）。

    Returns:
        文本块列表；空输入返回空列表。
    """
    text = normalize(text)
    if not text:
        return []

    chunk_size = max(50, chunk_size)
    overlap = max(0, min(overlap, chunk_size // 2))

    # 先拆成句子，再贪心装箱；超长句子退化为按字符切
    pieces: list[str] = []
    for sentence in _SENTENCE_SPLIT.split(text):
        if not sentence:
            continue
        if len(sentence) <= chunk_size:
            pieces.append(sentence)
        else:
            pieces.extend(
                sentence[i : i + chunk_size] for i in range(0, len(sentence), chunk_size)
            )

    chunks: list[str] = []
    buffer = ""
    for piece in pieces:
        if not buffer:
            buffer = piece
            continue
        # 还能装下就继续拼
        if len(buffer) + len(piece) <= chunk_size:
            buffer += piece
            continue

        chunks.append(buffer.strip())
        # 用上一块的尾巴做重叠，保证跨块语义连贯
        tail = buffer[-overlap:] if overlap else ""
        buffer = tail + piece

    if buffer.strip():
        chunks.append(buffer.strip())

    # 过滤掉纯空白块
    return [c for c in chunks if c]


def estimate_tokens(text: str) -> int:
    """粗略估算 token 数：中文按 1 字 1 token，英文按 4 字符 1 token。

    仅用于计量展示，不作为计费依据（真实用量以 provider 返回为准）。
    """
    chinese = len(re.findall(r"[\u4e00-\u9fff]", text))
    others = len(text) - chinese
    return chinese + others // 4
