"""向量检索：余弦相似度排序。

为什么在应用层算：
- M2 采用「向量存 JSON 列」的轻量方案，不引入 pgvector 依赖；
- 代价是需要把候选块读进内存，因此加了 candidate_limit 上限做保护；
- 后续切 pgvector 时，只需替换 `search_chunks` 的实现，调用方不变。
"""

from __future__ import annotations

import math


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """余弦相似度，范围 [-1, 1]；任一向量为零向量时返回 0。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def rank(
    query_vec: list[float],
    candidates: list[dict],
    *,
    top_k: int = 4,
    min_score: float = 0.15,
) -> list[dict]:
    """对候选块打分排序。

    Args:
        query_vec: 查询向量。
        candidates: 每个元素需含 `embedding` 与 `content`。
        top_k: 返回条数上限。
        min_score: 相似度下限，低于此值视为不相关（FR-K-11 检索兜底）。

    Returns:
        按分数降序的命中列表，每条附加 `score` 字段。
    """
    scored: list[dict] = []
    for item in candidates:
        vec = item.get("embedding")
        if not vec:
            continue
        score = cosine_similarity(query_vec, vec)
        if score < min_score:
            continue
        scored.append({**item, "score": score})

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]
