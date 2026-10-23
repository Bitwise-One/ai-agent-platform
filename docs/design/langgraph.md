# LangGraph 编排详细设计

> 对应 PRD §4.5、§4.6、§4.13。定义状态 schema、智能路由、多 Agent 协作拓扑、兜底与 checkpoint。

---

## 1. 总体状态 Schema

LangGraph 的 `StateGraph` 使用统一的 `AgentState`（`TypedDict`），所有节点共享并按 reducer 规则合并。

```python
from typing import TypedDict, Annotated, Any
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

class AgentState(TypedDict, total=False):
    # 请求上下文（不可变，入口注入）
    tenant_id: str
    application_id: str
    conversation_id: str
    user_id: str
    run_id: str
    workflow_version_id: str

    # 消息（reducer=add_messages，自动追加而非覆盖）
    messages: Annotated[list[BaseMessage], add_messages]

    # 路由结果
    route_decision: dict[str, Any]          # {agent_id, confidence, reason}
    route_candidates: list[dict]            # Top-K 候选

    # 执行状态
    current_agent: str                       # 当前正在执行的 agent_id
    iteration_count: int                     # 全局轮次计数（熔断用）
    last_outputs: list[str]                  # 最近 N 轮输出（死循环检测用）

    # 多 Agent 协作（fan-out/fan-in）
    parallel_results: dict[str, Any]         # 各并行 Agent 的独立临时结果
    final_output: str                        # 汇总后的最终输出

    # 隐藏返回（不展示在聊天框）
    hidden_responses: list[dict]

    # 终态标记
    terminal_status: str                     # completed/degraded/failed/...
```

**Reducer 约定（关键）：**

| 字段 | Reducer | 原因 |
|---|---|---|
| `messages` | `add_messages` | 消息追加，不覆盖 |
| `parallel_results` | 自定义深度合并 | 各并行 Agent 写自己的 key，互不覆盖 |
| `iteration_count` | `operator.add` 或自定义 +1 | 全局轮次累加 |
| 其余标量 | 默认覆盖 | 单一写入者，无冲突 |

> 并行 Agent 禁止直接写公共字段（如 `final_output`），必须先写 `parallel_results[自己的 key]`，由汇总节点统一合并（对应 PRD FR-MA-02）。

---

## 2. 核心图结构

```
START
  │
  ▼
[入口节点：参数校验 + 幂等检查]
  │
  ▼
[智能路由节点 Router]  ◄──────────────┐
  │  (语义/规则/混合)                  │
  ├──► 单 Agent 执行                  │
  │      │                            │
  │      ▼                            │
  │  [循环判定：是否继续?] ──是──┘ (iteration_count++)
  │      │否
  │      ▼
  ├──► 多 Agent 并行 (fan-out)
  │      │
  │      ▼
  │  [汇总节点 fan-in]
  │
  ▼
[输出校验节点 Guard]  ◄── 幻觉/注入拦截
  │
  ├── 通过 ──► [隐藏返回提取] ──► [终态节点]
  ├── 失败 ──► [降级节点] ──► [终态节点]
  └── 需人工 ──► [waiting_human] ──► (interrupt) ──► 终态
```

---

## 3. 智能路由节点设计

### 3.1 路由策略接口

```python
class RouterStrategy(Protocol):
    def route(self, state: AgentState) -> dict[str, Any]:
        """返回 {agent_id, confidence, reason} 或 Top-K 候选"""
        ...

# 三种实现
class SemanticRouter: ...   # LLM 判断意图 → 候选 Agent
class RuleRouter: ...       # 关键词/正则/结构化字段
class HybridRouter: ...     # 规则过滤 → 语义精选
```

### 3.2 路由决策结构

```python
{
    "strategy": "hybrid",              # semantic / rule / hybrid
    "candidates": [                    # Top-K 候选（语义路由）
        {"agent_id": "...", "confidence": 0.87},
        {"agent_id": "...", "confidence": 0.61}
    ],
    "selected": "agent_id",            # 最终选中的 agent
    "reason": "用户意图为合同审查，匹配合同助手",
    "fallback": "default_agent"        # 置信度低于阈值时的兜底 agent
}
```

### 3.3 路由兜底规则

- 语义路由置信度 < `threshold`（默认 0.6）时，回落到规则路由或默认 Agent。
- 候选为空时，进入降级节点，返回"无法理解，请转人工"。
- 路由决策全过程写入 trace（对应 PRD FR-O）。

---

## 4. 多 Agent 协作拓扑实现

| 拓扑 | LangGraph 实现 | 关键点 |
|---|---|---|
| 中心化调度 | Supervisor 节点 + 条件边分发子 Agent 节点 | Supervisor 持有汇总逻辑 |
| 循环接力 | 顺序节点链 `A → B → C` | 每节点输出写 messages，下一节点消费 |
| 广播投票 | `Send` 并行分发到 N 个 Agent → 汇总节点投票 | 各结果写 `parallel_results[key]` |
| 分层子图 | `StateGraph.compile()` 作为子图嵌入 | 子图状态与父图状态通过 input/output 映射 |

**广播投票示例（fan-out / fan-in）：**

```python
def fan_out(state):
    return [
        Send("agent_a", {"messages": state["messages"]}),
        Send("agent_b", {"messages": state["messages"]}),
    ]

def aggregate(state):
    # 汇总节点：投票/择优，写入 final_output
    results = state["parallel_results"]
    state["final_output"] = vote(results)
```

---

## 5. 兜底与熔断机制落地

### 5.1 熔断器（贯穿所有 LLM/工具节点）

```python
def guarded_node(func):
    def wrapper(state):
        # 1. 全局轮次熔断
        if state["iteration_count"] >= MAX_ITERATIONS:
            return terminal(state, "timed_out")
        # 2. 死循环检测
        if is_stalled(state["last_outputs"]):
            return terminal(state, "failed")
        # 3. 节点超时
        result = with_timeout(func, NODE_TIMEOUT_MS)(state)
        return result
    return wrapper
```

### 5.2 重试与降级

```python
def call_llm_with_fallback(state, primary, fallback):
    try:
        return retry(primary, retriable_errors=(429, 500, TimeoutError),
                     max_retries=3, backoff=exponential)
    except NonRetriableError:
        return terminal(state, "failed")       # 参数错误，不重试
    except MaxRetryExceeded:
        return fallback(state)                  # 降级到小模型/规则输出
```

### 5.3 结束态必达保证

- 图的所有分支**必须收敛到终态节点**，终态节点设置 `terminal_status`。
- 终态节点是唯一出口，任何异常都被 catch 后转入 `degraded` / `failed` / `escalated`。
- `waiting_human` 节点通过 LangGraph `interrupt()` 挂起，带超时；超时后自动 `escalated`。

---

## 6. Checkpoint 持久化

- **Saver**：`PostgresSaver`（主存储）+ `RedisSaver`（可选热点缓存，读写分离）。
- **thread_id = conversation_id**：会话即 checkpoint 隔离单元（对应 PRD §3.2）。
- 每个节点执行完毕即写 checkpoint，Worker 崩溃后按 `thread_id` 恢复最近快照续跑。
- 快照治理：消息滚动截断、快照 TTL、临时字段不落盘（对应 FR-D-05）。

```python
from langgraph.checkpoint.postgres import PostgresSaver

graph = builder.compile(
    checkpointer=PostgresSaver.from_conn_string(DSN),
    interrupt_before=["high_risk_action"],   # 高风险前人工介入
)
```

---

## 7. 人工介入（Human-in-the-Loop）

| 介入点 | 触发条件 | 实现 |
|---|---|---|
| 高风险操作前 | 删除/资金/外部推送 | `interrupt_before` |
| 多 Agent 冲突 | 汇总投票无法收敛 | `interrupt()` |
| 多次重试失败 | 超过重试上限 | 转 `escalated` |

人工确认后通过 `/interrupt` 接口注入决策，图从 checkpoint 恢复继续执行。

---

## 8. 可观测性埋点

每个节点包装 `trace_wrapper`，记录：

```python
{
    "run_id": "...",
    "node": "router",
    "kind": "route",            # llm / tool / node / route
    "latency_ms": 123,
    "tokens_in": 500,
    "tokens_out": 80,
    "status": "success",
    "detail": {"agent_id": "...", "confidence": 0.87}
}
```

写入 `trace_event` 表 + 可选 LangSmith 集成。
