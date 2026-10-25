# 编排控制台（前端）

React 18 + TypeScript + Vite 5 + Tailwind 3。所有能力都通过后端 `/api/v1` 提供，
本目录只做展示与交互，不持有业务规则。

## 快速开始

```bash
# 1) 起后端（另开一个终端，端口必须是 8000）
cd ../backend
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2) 起控制台
pnpm install
pnpm dev            # http://localhost:5173
```

首次进入会走引导：创建租户 → 创建应用 → 进入控制台。
想跳过手工造数据，可在 `backend` 目录执行 `uv run python scripts/seed_demo.py`，
它会生成一份演示数据（3 个 Agent + 售后知识库 + 主流程编排）。

> 注意用 `localhost:5173` 而不是 `127.0.0.1:5173`：Vite 默认只监听 localhost，
> 某些环境下 127.0.0.1 会连不上。

## 页面

| 路由 | 页面 | 关键能力 |
|---|---|---|
| `/` | 概览 | 资源计数、当前编排状态、接入能力快照 |
| `/workflows` | 工作流列表 | 新建、状态与应用绑定 |
| `/workflows/:id` | 编排画布 | 拖动节点、拉线连边、路由参数、结构校验、版本发布/回滚 |
| `/agents` | Agent | 提示词、模型、温度、路由关键词、知识库绑定、默认兜底 |
| `/integrations` | 工具与 Skills | MCP 服务管理、工具发现与人工确认试调用、脱敏调用日志、Skill 元信息与 WASM 沙箱测试；Agent 编辑中授权绑定 |
| `/knowledge` | 知识库 | 建库、入库文档、切分预览、检索调试验证召回 |
| `/models` | 模型目录 | 模型与单价、连通性探测 |
| `/playground` | 对话调试台 | SSE 流式对话，右侧同步展示路由决策 / RAG 命中 / 隐藏返回 / token |

## 目录

```
src/
├── pages/        页面（一页一文件，状态各自持有）
├── components/   Shell（布局）、ui.tsx（设计系统基础件）、icons.tsx
├── lib/          api.ts（信封解包 + SSE 解析）、hooks.ts（useAsync/useSubmit）、types.ts
├── state/        workspace.tsx（租户/应用上下文，注入 X-Tenant-Id / X-App-Id）
└── styles.css    设计令牌（颜色、圆角、字号、行高）+ 全局基线
```

## 约定

- **不要绕过 `lib/api.ts` 直接 fetch**：它统一处理响应信封、错误类型与租户头。
- **租户/应用上下文不要层层透传**：用 `useWorkspace()`，请求头由 API 客户端统一注入。
- 新增颜色/字号先加到 `styles.css` 的令牌里，再在 Tailwind 配置中映射，避免页面上出现裸色值。
- 空状态要区分「没有数据」和「出错了」：前者给引导按钮，后者给 `ErrorNote` + 重试。

## 依赖安装的两个坑（本机已验证）

- `pnpm-workspace.yaml` 里的 `nodeLinker: hoisted` 不能删。默认 isolated 布局依赖符号链接，
  本机建链失败会让 `node_modules/@types/*` 变成空目录，`tsc` 报大量找不到类型定义。
- pnpm 11 默认拦截依赖的 postinstall，`esbuild` 已在 `onlyBuiltDependencies` 里放行；
  新增需要编译的依赖时要同步补进这个名单，否则 `vite` 起不来。
