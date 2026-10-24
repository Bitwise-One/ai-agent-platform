"""文本切分与向量检索的单测。"""

from app.knowledge.chunker import estimate_tokens, split_text
from app.knowledge.retriever import cosine_similarity, rank


def test_split_text_respects_size_and_overlap():
    text = "第一句话。" * 120  # 约 600 字
    chunks = split_text(text, chunk_size=100, overlap=20)
    assert len(chunks) >= 4
    assert all(len(c) <= 130 for c in chunks)


def test_split_text_empty_returns_empty():
    assert split_text("   \n  ") == []


def test_split_text_long_sentence_hard_split():
    text = "啊" * 300
    chunks = split_text(text, chunk_size=100, overlap=0)
    assert all(len(c) <= 100 for c in chunks)
    assert sum(len(c) for c in chunks) >= 300


def test_estimate_tokens_counts_chinese():
    assert estimate_tokens("你好世界") == 4


def test_cosine_identical_is_one():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0


def test_cosine_orthogonal_is_zero():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_cosine_handles_zero_vector():
    assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_rank_filters_by_min_score_and_sorts():
    candidates = [
        {"content": "高相关", "embedding": [1.0, 0.0]},
        {"content": "低相关", "embedding": [0.0, 1.0]},
        {"content": "中等", "embedding": [0.8, 0.6]},
    ]
    hits = rank([1.0, 0.0], candidates, top_k=2, min_score=0.5)
    assert [h["content"] for h in hits] == ["高相关", "中等"]
    assert hits[0]["score"] > hits[1]["score"]
