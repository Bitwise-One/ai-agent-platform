# 模型网关详细设计

> 对应 PRD §4.13.9。定义 LLM 抽象接口、路由策略、降级链、配额限流、计量。Agent/工作流不直接面向模型厂商，统一面向网关。

---

## 1. 目标

- 屏蔽 OpenAI/Anthropic/国产大模型等厂商差异，提供统一调用接口。
- 支持模型路由（按复杂度/成本/延迟/租户偏好）、降级、配额、限流、计量。
- 密钥集中管理，不落 Agent，不落日志。

---

## 2. 统一抽象接口

```python
class LLMProvider(Protocol):
    async def complete(
        self,
        model: str,
        messages: list[dict],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        **kwargs,
    ) -> LLMResponse: ...

    async def stream(
        self,
        model: str,
        messages: list[dict],
        **kwargs,
    ) -> AsyncIterator[LLMChunk]: ...

class LLMResponse:
    text: str
    tokens_in: int
    tokens_out: int
    model: str
    latency_ms: int
    finish_reason: str
```

每个厂商一个 adapter 实现该接口，注册到网关：

```python
Gateway.register("openai", OpenAIProvider(...))
Gateway.register("anthropic", AnthropicProvider(...))
Gateway.register("qwen", QwenProvider(...))
```

---

## 3. 逻辑模型 vs 物理模型

- **逻辑模型（model_config 表）**：租户可见的模型名（如 `fast`、`smart`、`cheap`）。
- **物理模型**：具体供应商模型（如 `gpt-4o-mini`、`claude-3-5-sonnet`）。
- 网关维护逻辑→物理映射，切换供应商不影响业务层。

```python
model_config = {
    "name": "fast",                # 逻辑名
    "provider": "openai",
    "model_name": "gpt-4o-mini",   # 物理名
    "fallback": ["qwen-turbo", "rule-based"],
    "price_in": 0.15, "price_out": 0.60,
}
```

---

## 4. 模型路由策略

| 策略 | 依据 | 场景 |
|---|---|---|
| 固定 | 逻辑模型名 | 默认 |
| 复杂度路由 | 输入复杂度分类（小模型判断） | 简单任务省钱 |
| 成本路由 | 预算约束下选最便宜满足能力的模型 | FinOps |
| 延迟路由 | 优先低延迟模型 | 实时交互 |
| 租户偏好 | 租户指定默认模型 | 定制化 |

路由决策流程：

```
请求 → 解析逻辑模型 → 复杂度分类（可选）→ 选择物理模型
     → 配额/限流检查 → 调用 → 失败则按 fallback 链降级
```

---

## 5. 降级链（Fallback Chain）

每个逻辑模型配置降级链，主模型失败时依次尝试：

```
gpt-4o (主) → gpt-4o-mini (降级1) → rule-based 模板回复 (最终兜底)
```

降级触发条件：
- 超时（`node_timeout_ms`）
- 限流（429）
- 5xx 服务错误
- 连续失败熔断

**不可降级场景**：参数校验失败、内容安全拒绝（直接返回错误，不降级）。

---

## 6. 配额与限流

三级限流：

| 层级 | 维度 | 实现 |
|---|---|---|
| 租户 | token/调用量预算 | Redis 计数器 + 预算阈值 |
| 应用 | 并发数、QPS | 令牌桶 |
| 模型 | 供应商限流（RPM/TPM） | 网关内限流器 |

预算接近阈值时，自动切换到低成本模型（对应 FR-C-05）。

---

## 7. 计量（Metering）

每次调用记录：

```python
{
    "tenant_id": "...",
    "application_id": "...",
    "run_id": "...",
    "model": "fast",               # 逻辑名
    "provider_model": "gpt-4o-mini",
    "tokens_in": 500,
    "tokens_out": 80,
    "cost": 0.000123,              # 按 price_in/price_out 计算
    "latency_ms": 820,
}
```

- 写入 `trace_event` + 成本汇总表。
- 支持按租户/应用/模型/时间分账（对应 FR-C-06）。

---

## 8. 密钥管理

- 供应商密钥存入密钥管理服务（环境变量 / Vault / KMS），网关启动时加载到内存。
- `model_config` 表不存明文密钥，只存密钥引用标识。
- 密钥轮换：网关支持热加载，新密钥生效旧密钥平滑下线。
- 密钥绝不出现在日志、trace、异常信息中。

---

## 9. 熔断与健康检查

- 每个 provider 维护熔断器：连续 N 次失败 → 熔断，冷却期后试探性放行（半开）。
- 健康检查：定期探活，标记 provider 可用状态。
- 熔断期间，路由自动跳过该 provider，走降级链。
