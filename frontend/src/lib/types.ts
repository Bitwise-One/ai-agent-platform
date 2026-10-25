/**
 * 后端接口的响应类型（与 backend/app/schemas 保持一致）。
 *
 * 只声明控制台真正用到的字段，而不是把后端 schema 全量搬过来：
 * 全量镜像会让前端在字段改名时被动报错，而少字段在运行时更容易兜底。
 * 若某天需要强一致，应改为由 OpenAPI 生成类型，而不是手工维护。
 */

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

export interface Application {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  default_workflow_id: string | null;
  status: string;
  created_at: string;
}

export interface ModelConfig {
  id: string;
  tenant_id: string;
  name: string;
  provider: string;
  model_name: string;
  context_len: number | null;
  price_in: number | null;
  price_out: number | null;
  capabilities: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface ModelProbeResult {
  model_config_id: string;
  model_name: string;
  ready: boolean;
  ok: boolean;
  latency_ms: number;
  sample: string;
  detail: string | null;
}

export interface Agent {
  id: string;
  tenant_id: string;
  application_id: string;
  name: string;
  system_prompt: string;
  model_config_id: string | null;
  temperature: number;
  max_context_len: number;
  memory_strategy: string;
  keywords: string[];
  is_default: boolean;
  status: string;
  created_at: string;
}

export interface McpServer {
  id: string;
  tenant_id: string;
  name: string;
  transport: "stdio" | "sse" | "http" | string;
  config: Record<string, unknown>;
  status: "active" | "suspended" | "deleted" | string;
  created_at: string;
  updated_at: string;
}

export interface McpTool {
  id: string;
  mcp_id: string;
  name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  enabled: boolean;
  updated_at: string;
}

export interface McpCallLog {
  id: string;
  application_id: string;
  agent_id: string;
  mcp_id: string;
  tool_id: string;
  request_id: string | null;
  status: "success" | "error" | string;
  latency_ms: number;
  error_code: string | null;
  input_summary: Record<string, unknown> | null;
  output_summary: Record<string, unknown> | null;
  created_at: string;
}

export interface Skill {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  params_schema: Record<string, unknown> | null;
  trigger: Record<string, unknown> | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export type GraphNodeType = "router" | "agent" | "rag" | "guard" | "fallback" | "condition";

export interface GraphNode {
  id: string;
  type: GraphNodeType | string;
  label: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string | null;
  condition?: string | null;
}

export interface GraphDefinition {
  nodes: GraphNode[];
  edges: GraphEdge[];
  router: "rule" | "semantic" | "hybrid" | string;
  default_agent: string | null;
  max_iterations: number;
  confidence_threshold: number;
  rag_enabled: boolean;
  rag_top_k: number;
}

export interface Workflow {
  id: string;
  tenant_id: string;
  application_id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowVersion {
  id: string;
  workflow_id: string;
  version: number;
  changelog: string | null;
  status: string;
  created_at: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  embedding_model: string | null;
  vector_dim: number | null;
  created_at: string;
}

export interface KbDocument {
  id: string;
  kb_id: string;
  title: string;
  source: string | null;
  file_type: string | null;
  status: string;
  created_at: string;
}

export interface SearchHit {
  content: string;
  score: number;
  document_id: string;
  title: string;
}

export interface RagSource {
  index: number;
  document_id: string;
  title: string;
  score: number;
}

export interface HiddenResponse {
  action: string;
  payload: Record<string, unknown>;
}

export interface ChatResult {
  conversation_id: string;
  run_id: string;
  status: string;
  reply: string | null;
  hidden_responses: HiddenResponse[];
  token_usage: number;
  rag_sources: RagSource[];
}

export interface RouteInfo {
  strategy: string | null;
  selected: string | null;
  confidence: number | null;
  reason: string | null;
  candidates: Array<Record<string, unknown>>;
}

/** SSE 事件的联合类型：与后端 `stream_chat` 产出的 type 字段一一对应 */
export type StreamEvent =
  | { type: "meta"; run_id: string; conversation_id: string; application_id: string }
  | { type: "status"; status: string; detail?: string }
  | {
      type: "route";
      strategy: string;
      selected: string | null;
      confidence: number;
      reason: string;
    }
  | { type: "rag"; hits: number }
  | { type: "token"; text: string }
  | ({ type: "hidden" } & HiddenResponse)
  | {
      type: "done";
      status: string;
      run_id: string;
      token_usage: number;
      rag_sources: RagSource[];
      reason: string;
    };
