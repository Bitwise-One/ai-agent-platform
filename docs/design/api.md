# API 契约详细设计

> 对应 PRD §4.14、§4.10.1。定义 REST 端点、请求/响应 schema、流式事件、错误码、鉴权流程。

---

## 1. 基础约定

- Base URL：`/api/v1`
- 内容类型：`application/json`；流式用 `text/event-stream`（SSE）或 WebSocket。
- 所有响应统一信封：

```json
{
  "code": 0,
  "message": "success",
  "data": { },
  "request_id": "uuid"
}
```

- 所有请求头携带：`Authorization`（API Key 或 JWT）、`X-Tenant-Id`、`X-App-Id`。
- 会话请求额外携带 `X-Conversation-Id`（或 body 内 `conversation_id`）。

---

## 2. 鉴权流程

### 2.1 两种鉴权

| 场景 | 方式 | 说明 |
|---|---|---|
| 管理台 | 平台登录态（SSO/JWT） | 带角色 + 租户作用域 |
| C 端/后端调用 | 应用 API Key + 用户 JWT | API Key 标识应用，JWT 标识用户 |

### 2.2 鉴权中间件流程

```
请求 → 解析 Authorization
     → 校验 API Key（查 api_key 表，比对哈希，检查 scope/过期）
     → 注入 tenant_id / app_id
     → RLS: SET app.current_tenant_id
     → 校验 conversation_id 归属（会话级访问控制）
     → 放行 / 拒绝
```

---

## 3. REST 端点清单

### 3.1 对话与会话

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/apps/{app_id}/chat` | 非流式对话，阻塞返回完整结果 |
| POST | `/apps/{app_id}/chat/stream` | 流式对话（SSE） |
| POST | `/conversations` | 创建会话 |
| GET | `/conversations` | 会话列表（分页） |
| GET | `/conversations/{id}` | 会话详情 |
| DELETE | `/conversations/{id}` | 删除会话 |
| GET | `/conversations/{id}/messages` | 历史消息分页 |
| POST | `/conversations/{id}/interrupt` | 人工介入 / 取消 |

### 3.2 管理台（租户/应用/Agent/工作流）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST/GET/PUT/DELETE | `/tenants` | 租户 CRUD（平台管理员） |
| POST/GET/PUT/DELETE | `/apps` | 应用 CRUD |
| POST/GET/PUT/DELETE | `/apps/{id}/agents` | Agent CRUD |
| POST/GET/PUT/DELETE | `/apps/{id}/workflows` | 工作流 CRUD |
| POST | `/workflows/{id}/versions` | 创建版本 |
| POST | `/workflows/{id}/release` | 发布/灰度 |
| POST | `/workflows/{id}/rollback` | 回滚 |
| POST/GET/PUT/DELETE | `/knowledge-bases` | 知识库 CRUD |
| POST | `/knowledge-bases/{id}/documents` | 上传文档 |
| POST/GET/PUT/DELETE | `/mcp-servers` | MCP 管理 |
| POST/GET/PUT/DELETE | `/skills` | Skill 管理 |
| POST/GET/PUT/DELETE | `/models` | 模型配置（模型网关） |
| POST/GET/DELETE | `/api-keys` | API Key 管理 |

---

## 4. 关键请求/响应示例

### 4.1 创建会话并发起对话

```json
POST /api/v1/apps/{app_id}/chat/stream
Headers: Authorization: Bearer <jwt>, X-Tenant-Id, X-App-Id
{
  "user_id": "u_123",
  "conversation_id": null,          // 为空则新建会话
  "message": "帮我审查这份合同",
  "idempotency_key": "ik_xxx",      // 幂等键
  "metadata": {}
}
```

### 4.2 流式响应（SSE）

```text
event: meta
data: {"run_id":"r1","conversation_id":"c1","version":"v3"}

event: token
data: {"text":"正在"}

event: tool_call
data: {"tool":"contract_search","status":"start"}

event: hidden
data: {"type":"hidden","action":"render_chart","payload":{"chart_id":"c1"}}

event: token
data: {"text":"..."}

event: status
data: {"status":"running"}

event: done
data: {"status":"completed","token_usage":1234,"cost":0.012}
```

### 4.3 人工介入

```json
POST /api/v1/conversations/{id}/interrupt
{
  "run_id": "r1",
  "decision": "approve",            // approve / reject / modify
  "modification": "..."              // modify 时的修改内容
}
```

---

## 5. 错误码规范

| code | HTTP | 含义 |
|---|---|---|
| 0 | 200 | 成功 |
| 10001 | 400 | 参数校验失败（不可重试） |
| 10002 | 401 | 未认证 / 密钥无效 |
| 10003 | 403 | 无权限 / 越权（含跨租户） |
| 10004 | 404 | 资源不存在 |
| 10005 | 429 | 限流 / 配额超限（可重试） |
| 10006 | 500 | 服务内部错误 |
| 10007 | 503 | 模型/工具不可用（可降级） |
| 10008 | 408 | 超时 |
| 10009 | 409 | 幂等冲突（重复提交） |

> 错误响应 `data` 内携带 `retriable: true/false`，供 SDK 判断是否重试。

---

## 6. 分页与幂等

- 分页：`?page=1&page_size=20`，响应带 `total`。
- 幂等：写操作支持 `idempotency_key`，服务端以 `(tenant_id, idempotency_key)` 去重，冲突返回 `10009`。
- 流式断线续传：客户端带 `Last-Event-ID` 或 `run_id` 重连，服务端从 checkpoint 恢复，不重复执行。

---

## 7. Webhook（第三方事件订阅）

```
POST /api/v1/webhooks/{app_id}
Headers: X-Webhook-Signature (HMAC 签名)

事件类型：
- run.completed / run.failed / run.escalated
- message.created
- hidden.triggered
```

第三方系统通过管理台配置 webhook URL + 签名密钥，事件异步推送，支持重试。
