/**
 * API 客户端：统一信封解包、租户上下文注入、SSE 增量解析。
 *
 * 三个设计决定：
 * 1. **相对路径**：所有请求走 `/api/...`，由 Vite 代理到后端。生产同源部署时
 *    无需改代码，也不必在后端开 CORS。
 * 2. **租户/应用上下文放在模块级变量**里，由 <WorkspaceProvider> 写入。
 *    相比把 tenantId 一层层透传到每个请求，这种写法更省样板代码；代价是不能
 *    同时操作两个租户——控制台的场景本就不需要。
 * 3. **错误统一成 ApiError**，页面只处理一种错误类型，避免各处判断 res.ok。
 */

import type {
  Agent,
  Application,
  ChatResult,
  Conversation,
  ConversationMessage,
  GraphDefinition,
  KbDocument,
  KnowledgeBase,
  ModelConfig,
  ModelProbeResult,
  McpServer,
  McpTool,
  McpCallLog,
  Skill,
  SearchHit,
  StreamEvent,
  Tenant,
  Workflow,
  WorkflowVersion,
} from "./types";

const BASE = "";

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
  request_id?: string | null;
}

export class ApiError extends Error {
  status: number;
  code: number;
  requestId?: string | null;

  constructor(message: string, status: number, code: number, requestId?: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** 当前工作区（由 Provider 注入，供所有请求复用） */
const workspace = { tenantId: null as string | null, appId: null as string | null };

export function setWorkspace(next: { tenantId?: string | null; appId?: string | null }) {
  if (next.tenantId !== undefined) workspace.tenantId = next.tenantId;
  if (next.appId !== undefined) workspace.appId = next.appId;
}

export function getWorkspace() {
  return { ...workspace };
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (workspace.tenantId) headers["X-Tenant-Id"] = workspace.tenantId;
  if (workspace.appId) headers["X-App-Id"] = workspace.appId;
  return { ...headers, ...extra };
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: baseHeaders(options.headers),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  let payload: Envelope<T> | null = null;
  try {
    payload = (await res.json()) as Envelope<T>;
  } catch {
    // 204 或非 JSON 响应（网关错误页）走这里
  }

  if (!res.ok || (payload && payload.code !== 0)) {
    throw new ApiError(
      payload?.message || `请求失败（HTTP ${res.status}）`,
      res.status,
      payload?.code ?? res.status,
      payload?.request_id,
    );
  }
  if (!payload) {
    throw new ApiError("响应不是合法 JSON", res.status, -1);
  }
  return payload.data;
}

/** 列表接口有两种信封（Page 带分页、dict 只有 items/total），统一成 items */
async function list<T>(path: string): Promise<T[]> {
  const data = await request<{ items?: T[] }>(path);
  return data?.items ?? [];
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  list,
};

/* ------------------------------------------------------------------ 领域封装 */

export const tenantsApi = {
  list: () => api.list<Tenant>("/api/v1/tenants?page_size=200"),
  create: (name: string, slug: string, quota?: Record<string, unknown>) =>
    api.post<Tenant>("/api/v1/tenants", { name, slug, ...(quota ? { quota } : {}) }),
  update: (id: string, body: Record<string, unknown>) => api.patch<Tenant>(`/api/v1/tenants/${id}`, body),
  remove: (id: string) => api.del<unknown>(`/api/v1/tenants/${id}`),
};

export const appsApi = {
  list: () => api.list<Application>("/api/v1/apps?page_size=200"),
  create: (name: string, description?: string) =>
    api.post<Application>("/api/v1/apps", { name, description }),
  get: (id: string) => api.get<Application>(`/api/v1/apps/${id}`),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<Application>(`/api/v1/apps/${id}`, body),
  remove: (id: string) => api.del<unknown>(`/api/v1/apps/${id}`),
};

export const modelsApi = {
  list: () => api.list<ModelConfig>("/api/v1/models"),
  create: (body: Record<string, unknown>) => api.post<ModelConfig>("/api/v1/models", body),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<ModelConfig>(`/api/v1/models/${id}`, body),
  setCredential: (id: string, apiKey: string) =>
    api.put<{ configured: boolean }>(`/api/v1/models/${id}/credential`, { action: "set", api_key: apiKey }),
  clearCredential: (id: string) =>
    api.put<{ configured: boolean }>(`/api/v1/models/${id}/credential`, { action: "clear" }),
  remove: (id: string) => api.del<unknown>(`/api/v1/models/${id}`),
  probe: (id: string) => api.post<ModelProbeResult>(`/api/v1/models/${id}/probe`),
};

export const agentsApi = {
  list: (appId: string) => api.list<Agent>(`/api/v1/apps/${appId}/agents`),
  create: (appId: string, body: Record<string, unknown>) =>
    api.post<Agent>(`/api/v1/apps/${appId}/agents`, body),
  update: (appId: string, id: string, body: Record<string, unknown>) =>
    api.patch<Agent>(`/api/v1/apps/${appId}/agents/${id}`, body),
  remove: (appId: string, id: string) =>
    api.del<unknown>(`/api/v1/apps/${appId}/agents/${id}`),
  bindKbs: (appId: string, id: string, kbIds: string[]) =>
    api.put<{ kb_ids: string[] }>(`/api/v1/apps/${appId}/agents/${id}/knowledge-bases`, {
      kb_ids: kbIds,
    }),
  boundKbs: (appId: string, id: string) =>
    api.get<{ kb_ids: string[] }>(`/api/v1/apps/${appId}/agents/${id}/knowledge-bases`),
  boundMcpServers: (appId: string, id: string) =>
    api.get<{ ids: string[] }>(`/api/v1/apps/${appId}/agents/${id}/mcp-servers`),
  bindMcpServers: (appId: string, id: string, ids: string[]) =>
    api.put<{ ids: string[] }>(`/api/v1/apps/${appId}/agents/${id}/mcp-servers`, { ids }),
  boundSkills: (appId: string, id: string) =>
    api.get<{ ids: string[] }>(`/api/v1/apps/${appId}/agents/${id}/skills`),
  bindSkills: (appId: string, id: string, ids: string[]) =>
    api.put<{ ids: string[] }>(`/api/v1/apps/${appId}/agents/${id}/skills`, { ids }),
  boundMcpTools: (appId: string, id: string) =>
    api.get<{ ids: string[] }>(`/api/v1/apps/${appId}/agents/${id}/mcp-tools`),
  bindMcpTools: (appId: string, id: string, ids: string[]) =>
    api.put<{ ids: string[] }>(`/api/v1/apps/${appId}/agents/${id}/mcp-tools`, { ids }),
  callMcpTool: (appId: string, agentId: string, toolId: string, params: Record<string, unknown>) =>
    api.post<{ status: string; result: Record<string, unknown>; latency_ms: number }>(
      `/api/v1/apps/${appId}/agents/${agentId}/mcp-tools/${toolId}/call`,
      { params },
    ),
};

export const integrationsApi = {
  listMcpServers: () => api.list<McpServer>("/api/v1/mcp-servers?page_size=200"),
  createMcpServer: (body: Record<string, unknown>) =>
    api.post<McpServer>("/api/v1/mcp-servers", body),
  updateMcpServer: (id: string, body: Record<string, unknown>) =>
    api.patch<McpServer>(`/api/v1/mcp-servers/${id}`, body),
  removeMcpServer: (id: string) => api.del<unknown>(`/api/v1/mcp-servers/${id}`),
  discoverMcpTools: (id: string) =>
    api.post<{ mcp_id: string; tools: McpTool[]; total: number }>(`/api/v1/mcp-servers/${id}/discover`),
  listMcpTools: (id: string) =>
    api.get<{ items: McpTool[]; total: number }>(`/api/v1/mcp-servers/${id}/tools`),
  listMcpCallLogs: (page = 1, status?: "success" | "error") => {
    const params = new URLSearchParams({ page: String(page), page_size: "20" });
    if (status) params.set("status", status);
    return api.get<{ items: McpCallLog[]; total: number; page: number; page_size: number }>(
      `/api/v1/mcp-servers/calls/logs?${params.toString()}`,
    );
  },
  listSkills: () => api.list<Skill>("/api/v1/skills?page_size=200"),
  createSkill: (body: Record<string, unknown>) => api.post<Skill>("/api/v1/skills", body),
  updateSkill: (id: string, body: Record<string, unknown>) =>
    api.patch<Skill>(`/api/v1/skills/${id}`, body),
  removeSkill: (id: string) => api.del<unknown>(`/api/v1/skills/${id}`),
  invokeSkill: (id: string, params: Record<string, unknown>) =>
    api.post<{ skill_id: string; result: unknown }>(`/api/v1/skills/${id}/invoke`, { params }),
};

export const workflowsApi = {
  list: (appId: string) => api.list<Workflow>(`/api/v1/apps/${appId}/workflows`),
  create: (appId: string, body: Record<string, unknown>) =>
    api.post<Workflow>(`/api/v1/apps/${appId}/workflows`, body),
  update: (appId: string, id: string, body: Record<string, unknown>) =>
    api.patch<Workflow>(`/api/v1/apps/${appId}/workflows/${id}`, body),
  remove: (appId: string, id: string) => api.del<{ deleted: string; archived: boolean }>(`/api/v1/apps/${appId}/workflows/${id}`),
  getGraph: (appId: string, wfId: string) =>
    api.get<GraphDefinition>(`/api/v1/apps/${appId}/workflows/${wfId}/graph`),
  saveGraph: (appId: string, wfId: string, graph: GraphDefinition) =>
    api.put<GraphDefinition>(`/api/v1/apps/${appId}/workflows/${wfId}/graph`, graph),
  versions: (appId: string, wfId: string) =>
    api.list<WorkflowVersion>(`/api/v1/apps/${appId}/workflows/${wfId}/versions`),
  createVersion: (appId: string, wfId: string, changelog: string) =>
    api.post<WorkflowVersion>(`/api/v1/apps/${appId}/workflows/${wfId}/versions`, {
      changelog,
    }),
  release: (appId: string, wfId: string, versionId: string) =>
    api.post<WorkflowVersion>(`/api/v1/apps/${appId}/workflows/${wfId}/release`, {
      version_id: versionId,
      bind_to_app: true,
    }),
  rollback: (appId: string, wfId: string, versionId: string) =>
    api.post<WorkflowVersion>(`/api/v1/apps/${appId}/workflows/${wfId}/rollback`, {
      version_id: versionId,
    }),
};

export const knowledgeApi = {
  list: () => api.list<KnowledgeBase>("/api/v1/knowledge-bases?page_size=200"),
  create: (name: string, description?: string) =>
    api.post<KnowledgeBase>("/api/v1/knowledge-bases", { name, description }),
  update: (id: string, body: Record<string, unknown>) => api.patch<KnowledgeBase>(`/api/v1/knowledge-bases/${id}`, body),
  remove: (id: string) => api.del<unknown>(`/api/v1/knowledge-bases/${id}`),
  documents: (kbId: string) =>
    api.list<KbDocument>(`/api/v1/knowledge-bases/${kbId}/documents`),
  ingest: (kbId: string, title: string, content: string, source?: string, fileType = "text") =>
    api.post<KbDocument>(`/api/v1/knowledge-bases/${kbId}/documents`, { title, content, source, file_type: fileType }),
  removeDocument: (kbId: string, docId: string) =>
    api.del<unknown>(`/api/v1/knowledge-bases/${kbId}/documents/${docId}`),
  search: (kbId: string, query: string, topK = 5) =>
    api.post<{ hits: SearchHit[]; took_ms: number }>(
      `/api/v1/knowledge-bases/${kbId}/search`,
      { query, top_k: topK },
    ),
};

export const chatApi = {
  send: (appId: string, userId: string, message: string) =>
    api.post<ChatResult>(`/api/v1/apps/${appId}/chat`, {
      user_id: userId,
      message,
    }),
};

export const conversationsApi = {
  list: (page = 1, userId?: string) => {
    const query = new URLSearchParams({ page: String(page), page_size: "25" });
    if (userId) query.set("user_id", userId);
    return api.get<{ items: Conversation[]; total: number; page: number; page_size: number }>(
      `/api/v1/conversations?${query.toString()}`,
    );
  },
  messages: (id: string, page = 1) =>
    api.get<{ items: ConversationMessage[]; total: number; page: number; page_size: number }>(
      `/api/v1/conversations/${id}/messages?page=${page}&page_size=50`,
    ),
  archive: (id: string) => api.del<{ archived: string; status: string }>(`/api/v1/conversations/${id}`),
};

/* ------------------------------------------------------------------ SSE */

/**
 * 流式对话：POST + ReadableStream 手工解析。
 *
 * 为什么不用 EventSource：SSE 规范里 EventSource 只支持 GET，而对话要带
 * JSON 请求体（消息、user_id），只能用 fetch 读流。
 *
 * 解析要点：SSE 以「空行」分帧，帧内 `event:` 是类型、`data:` 是完整 JSON。
 * 网络分片可能把一帧切在中间，因此必须缓存未完成的尾巴再拼接。
 */
export async function streamChat(
  appId: string,
  body: { user_id: string; message: string; conversation_id?: string },
  handlers: {
    onEvent: (event: StreamEvent) => void;
    onError?: (error: Error) => void;
    onHiddenAction?: (event: Extract<StreamEvent, { type: "hidden" }>) => void;
  },
  signal?: AbortSignal,
  options: { idempotencyKey?: string; lastEventId?: number } = {},
): Promise<void> {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  let lastEventId = options.lastEventId ?? 0;
  const maxReconnects = 4;
  try {
    for (let attempt = 0; attempt <= maxReconnects; attempt += 1) {
      if (signal?.aborted) return;
      const res = await fetch(`${BASE}/api/v1/apps/${appId}/chat/stream`, {
        method: "POST",
        headers: baseHeaders({
          Accept: "text/event-stream",
          "Idempotency-Key": idempotencyKey,
          ...(lastEventId ? { "Last-Event-ID": String(lastEventId) } : {}),
        }),
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok || !res.body) {
        throw new ApiError(`流式请求失败（HTTP ${res.status}）`, res.status, res.status);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const lines = frame.split(/\r?\n/);
          const idLine = lines.find((line) => line.startsWith("id:"));
          const dataLine = lines.find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
            const frameId = Number(idLine?.slice(3).trim() ?? ("id" in event ? event.id : 0));
            if (Number.isFinite(frameId) && frameId > 0 && frameId <= lastEventId) continue;
            if (Number.isFinite(frameId) && frameId > 0) lastEventId = frameId;
            if (event.type === "hidden") handlers.onHiddenAction?.(event);
            handlers.onEvent(event);
            if (event.type === "done") completed = true;
          } catch {
            // Ignore malformed frames and keep the stream alive.
          }
        }
      }
      if (completed) return;
      if (attempt < maxReconnects) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(resolve, Math.min(250 * 2 ** attempt, 2000));
          signal?.addEventListener("abort", () => {
            window.clearTimeout(timeout);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
    }
    throw new Error("事件流在重连次数耗尽后仍未收到 done 事件");
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    handlers.onError?.(error as Error);
  }
}
