# 详细设计文档索引

本目录存放从 PRD 骨架落地的详细设计文档，供开发直接引用。

| 文档 | 内容 | 对应 PRD |
|---|---|---|
| [database.md](database.md) | PostgreSQL 建表 DDL、多对多关联表、checkpoint、审计、RLS、迁移规范 | §6.1 |
| [langgraph.md](langgraph.md) | AgentState、图结构、智能路由、多 Agent 协作、兜底熔断、checkpoint、HITL | §4.5/4.6/4.13 |
| [api.md](api.md) | REST 端点、请求/响应 schema、流式事件、错误码、鉴权、幂等、Webhook | §4.14/4.10.1 |
| [backend-structure.md](backend-structure.md) | 后端目录结构、分层架构、中间件、配置、测试策略 | AGENTS.md §5 |
| [model-gateway.md](model-gateway.md) | 模型抽象、路由、降级链、配额限流、计量、密钥管理、熔断 | §4.13.9 |

**阅读顺序建议**：database → langgraph → api → backend-structure → model-gateway。

**与 PRD 的关系**：PRD 回答「要做什么」，本目录回答「怎么做」。若两者冲突，以 PRD 为准并回填修正设计文档。
