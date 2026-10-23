"""兜底守卫：熔断、死循环检测、输出校验（对应 PRD §4.13.1 / FR-R-02~04）。

设计要点：「结束态必达」——所有分支都必须收敛到终态，绝不无限挂起。
"""

from difflib import SequenceMatcher

STALL_SIMILARITY = 0.95
STALL_WINDOW = 3


def is_stalled(last_outputs: list[str], window: int = STALL_WINDOW) -> bool:
    """连续多轮输出高度相似 → 判定为原地打转。"""
    recent = [o for o in last_outputs if o][-window:]
    if len(recent) < window:
        return False
    for prev, curr in zip(recent, recent[1:], strict=False):
        if SequenceMatcher(None, prev, curr).ratio() < STALL_SIMILARITY:
            return False
    return True


def check_iteration(iteration: int, max_iterations: int) -> str | None:
    if iteration > max_iterations:
        return f"超过最大迭代轮次({max_iterations})"
    return None


def guard_output(text: str | None) -> tuple[bool, str]:
    """输出校验：空输出/异常缩写视为不合格，需走降级。"""
    if not text or not text.strip():
        return False, "输出为空"
    if len(text.strip()) < 2:
        return False, "输出过短"
    return True, ""
