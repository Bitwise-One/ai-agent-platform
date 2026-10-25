import { useRef, useState, type ChangeEvent } from "react";

import { agentsApi, integrationsApi } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useWorkspace } from "../state/workspace";
import {
  Button,
  Card,
  CardHeader,
  Empty,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatusTag,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from "../components/ui";
import { IconAgent, IconBook, IconPlay, IconPlug, IconPlus, IconPuzzle, IconRefresh, IconTrash } from "../components/icons";
import type { McpCallLog, McpServer, McpTool, Skill } from "../lib/types";

type View = "mcp" | "skills";
type Transport = "http" | "sse" | "stdio";

interface McpForm {
  name: string;
  transport: Transport;
  endpoint: string;
  secretRef: string;
}

interface SkillForm {
  name: string;
  description: string;
  instructions: string;
  paramsSchema: string;
  trigger: string;
  wasmBase64: string;
}

const emptyMcp: McpForm = { name: "", transport: "http", endpoint: "", secretRef: "" };
const emptySkill: SkillForm = {
  name: "",
  description: "",
  instructions: "",
  paramsSchema: "",
  trigger: "",
  wasmBase64: "",
};

function parseObject(text: string, label: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined;
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return value as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function mcpEndpoint(server: McpServer): string {
  return typeof server.config.url === "string" ? server.config.url : "受控 Worker";
}

function mcpSecretRef(server: McpServer): string {
  const auth = server.config.auth;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return "未配置";
  const secretRef = (auth as Record<string, unknown>).secret_ref;
  return typeof secretRef === "string" ? secretRef : "未配置";
}

function jsonText(value: Record<string, unknown> | null | undefined): string {
  return value ? JSON.stringify(value, null, 2) : "";
}

export function IntegrationsPage() {
  const { app, tenant } = useWorkspace();
  const appId = app?.id ?? "";
  const toast = useToast();
  const mcpServers = useAsync(() => integrationsApi.listMcpServers(), [tenant?.id], { enabled: Boolean(tenant?.id) });
  const skills = useAsync(() => integrationsApi.listSkills(), [tenant?.id], { enabled: Boolean(tenant?.id) });
  const agents = useAsync(() => agentsApi.list(appId), [appId], { enabled: Boolean(appId) });

  const [view, setView] = useState<View>("mcp");
  const [mcpDialog, setMcpDialog] = useState(false);
  const [skillDialog, setSkillDialog] = useState(false);
  const [editingMcp, setEditingMcp] = useState<McpServer | null>(null);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [mcpForm, setMcpForm] = useState<McpForm>(emptyMcp);
  const [skillForm, setSkillForm] = useState<SkillForm>(emptySkill);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [busyMcp, setBusyMcp] = useState<string | null>(null);
  const [toolsServerId, setToolsServerId] = useState<string | null>(null);
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpTool[]>>({});
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [logStatus, setLogStatus] = useState<"" | "success" | "error">("");
  const [logPage, setLogPage] = useState(1);
  const callLogs = useAsync(
    () => integrationsApi.listMcpCallLogs(logPage, logStatus || undefined),
    [tenant?.id, logPage, logStatus],
    { enabled: view === "mcp" && Boolean(tenant?.id) },
  );
  const [callingTool, setCallingTool] = useState<{ server: McpServer; tool: McpTool } | null>(null);
  const [callAgentId, setCallAgentId] = useState("");
  const [callParams, setCallParams] = useState("{}");
  const [callResult, setCallResult] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [invokeSkill, setInvokeSkill] = useState<Skill | null>(null);
  const [invokeParams, setInvokeParams] = useState("{}");
  const [invokeResult, setInvokeResult] = useState<string | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [busySkillId, setBusySkillId] = useState<string | null>(null);
  const wasmInputRef = useRef<HTMLInputElement>(null);

  const openCreateMcp = () => {
    setEditingMcp(null);
    setMcpForm(emptyMcp);
    setFormError(null);
    setMcpDialog(true);
  };

  const openEditMcp = (server: McpServer) => {
    setEditingMcp(server);
    setMcpForm({
      name: server.name,
      transport: server.transport as Transport,
      endpoint: typeof server.config.url === "string" ? server.config.url : "",
      secretRef: mcpSecretRef(server) === "未配置" ? "" : mcpSecretRef(server),
    });
    setFormError(null);
    setMcpDialog(true);
  };

  const saveMcp = async () => {
    setFormError(null);
    if (!mcpForm.name.trim()) return setFormError("请填写服务名称");
    if (mcpForm.transport !== "stdio") {
      try {
        const endpoint = new URL(mcpForm.endpoint.trim());
        if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
          return setFormError("服务地址必须使用 HTTP 或 HTTPS");
        }
        if (endpoint.username || endpoint.password) {
          return setFormError("请勿在 URL 中嵌入凭据，请使用密钥引用");
        }
        if (endpoint.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname)) {
          return setFormError("非本地 MCP 服务必须使用 HTTPS");
        }
      } catch {
        return setFormError("请输入有效的 MCP 服务地址");
      }
    }
    if (mcpForm.secretRef && !/^[A-Z][A-Z0-9_]{0,63}$/.test(mcpForm.secretRef.trim())) {
      return setFormError("密钥引用只能包含大写字母、数字和下划线，并以字母开头");
    }

    const config: Record<string, unknown> = {};
    if (mcpForm.transport !== "stdio") config.url = mcpForm.endpoint.trim();
    if (mcpForm.secretRef.trim()) {
      config.auth = { scheme: "bearer", secret_ref: mcpForm.secretRef.trim() };
    }
    setPending(true);
    try {
      const payload = { name: mcpForm.name.trim(), transport: mcpForm.transport, config };
      if (editingMcp) await integrationsApi.updateMcpServer(editingMcp.id, payload);
      else await integrationsApi.createMcpServer(payload);
      setMcpDialog(false);
      toast.push(editingMcp ? "MCP 服务已更新" : "MCP 服务已添加");
      await mcpServers.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const discoverTools = async (server: McpServer) => {
    setBusyMcp(server.id);
    setToolsError(null);
    try {
      const result = await integrationsApi.discoverMcpTools(server.id);
      setToolsByServer((previous) => ({ ...previous, [server.id]: result.tools }));
      setToolsServerId(server.id);
      toast.push(`已发现 ${result.total} 个工具`);
    } catch (error) {
      setToolsError(errorMessage(error));
    } finally {
      setBusyMcp(null);
    }
  };

  const showTools = async (server: McpServer) => {
    setToolsError(null);
    setToolsServerId(toolsServerId === server.id ? null : server.id);
    if (toolsByServer[server.id]) return;
    try {
      const result = await integrationsApi.listMcpTools(server.id);
      setToolsByServer((previous) => ({ ...previous, [server.id]: result.items }));
    } catch (error) {
      setToolsError(errorMessage(error));
    }
  };

  const toggleMcp = async (server: McpServer) => {
    const status = server.status === "active" ? "suspended" : "active";
    setBusyMcp(server.id);
    try {
      await integrationsApi.updateMcpServer(server.id, { status });
      toast.push(status === "active" ? "MCP 服务已启用" : "MCP 服务已暂停");
      await mcpServers.reload();
    } catch (error) {
      toast.push(errorMessage(error), "error");
    } finally {
      setBusyMcp(null);
    }
  };

  const deleteMcp = async (server: McpServer) => {
    if (!window.confirm(`删除 MCP 服务「${server.name}」？现有 Agent 绑定将失效。`)) return;
    try {
      await integrationsApi.removeMcpServer(server.id);
      toast.push("MCP 服务已删除");
      if (toolsServerId === server.id) setToolsServerId(null);
      await mcpServers.reload();
    } catch (error) {
      toast.push(errorMessage(error), "error");
    }
  };

  const openCreateSkill = () => {
    setEditingSkill(null);
    setSkillForm(emptySkill);
    setFormError(null);
    setSkillDialog(true);
  };

  const openEditSkill = (skill: Skill) => {
    setEditingSkill(skill);
    setSkillForm({
      name: skill.name,
      description: skill.description ?? "",
      instructions: skill.instructions ?? "",
      paramsSchema: jsonText(skill.params_schema),
      trigger: jsonText(skill.trigger),
      wasmBase64: "",
    });
    setFormError(null);
    setSkillDialog(true);
  };

  const saveSkill = async () => {
    setFormError(null);
    if (!skillForm.name.trim()) return setFormError("请填写 Skill 名称");
    let paramsSchema: Record<string, unknown> | undefined;
    let trigger: Record<string, unknown> | undefined;
    try {
      paramsSchema = parseObject(skillForm.paramsSchema, "参数 Schema");
      trigger = parseObject(skillForm.trigger, "触发条件");
    } catch (error) {
      return setFormError(errorMessage(error));
    }
    const payload: Record<string, unknown> = {
      name: skillForm.name.trim(),
      description: skillForm.description.trim() || null,
      instructions: skillForm.instructions.trim() || null,
      params_schema: paramsSchema ?? null,
      trigger: trigger ?? null,
    };
    if (!editingSkill || skillForm.wasmBase64.trim()) {
      payload.wasm_module_base64 = skillForm.wasmBase64.trim() || null;
    }
    setPending(true);
    try {
      if (editingSkill) await integrationsApi.updateSkill(editingSkill.id, payload);
      else await integrationsApi.createSkill(payload);
      setSkillDialog(false);
      toast.push(editingSkill ? "Skill 已更新" : "Skill 已创建");
      await skills.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const loadWasmFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 256 * 1024) {
      setFormError("WebAssembly 模块不能超过 256 KiB");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
        setFormError("所选文件不是有效的 WebAssembly 模块");
        return;
      }
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      setFormError(null);
      setSkillForm((previous) => ({ ...previous, wasmBase64: window.btoa(binary) }));
    } catch {
      setFormError("无法读取 WebAssembly 文件");
    }
  };

  const deleteSkill = async (skill: Skill) => {
    if (!window.confirm(`删除 Skill「${skill.name}」？已绑定的 Agent 将解除绑定。`)) return;
    try {
      await integrationsApi.removeSkill(skill.id);
      toast.push("Skill 已删除");
      await skills.reload();
    } catch (error) {
      toast.push(errorMessage(error), "error");
    }
  };

  const runSkill = async () => {
    if (!invokeSkill) return;
    setInvokeError(null);
    setInvokeResult(null);
    let params: Record<string, unknown>;
    try {
      params = parseObject(invokeParams, "调用参数") ?? {};
    } catch (error) {
      setInvokeError(errorMessage(error));
      return;
    }
    setBusySkillId(invokeSkill.id);
    try {
      const result = await integrationsApi.invokeSkill(invokeSkill.id, params);
      setInvokeResult(JSON.stringify(result.result, null, 2));
    } catch (error) {
      setInvokeError(errorMessage(error));
    } finally {
      setBusySkillId(null);
    }
  };

  const runMcpTool = async () => {
    if (!callingTool || !callAgentId || !appId) {
      setCallError("选择一个 Agent 后才能执行 MCP 工具");
      return;
    }
    setCallError(null);
    setCallResult(null);
    let params: Record<string, unknown>;
    try {
      params = parseObject(callParams, "调用参数") ?? {};
    } catch (error) {
      setCallError(errorMessage(error));
      return;
    }
    setBusyMcp(callingTool.tool.id);
    try {
      const result = await agentsApi.callMcpTool(appId, callAgentId, callingTool.tool.id, params);
      setCallResult(JSON.stringify(result, null, 2));
      await callLogs.reload();
    } catch (error) {
      setCallError(errorMessage(error));
      await callLogs.reload();
    } finally {
      setBusyMcp(null);
    }
  };

  const selectedServer = (mcpServers.data ?? []).find((server) => server.id === toolsServerId);

  return (
    <div>
      <PageHeader
        title="工具与 Skills"
        description="管理租户级 MCP 服务与可复用能力，并绑定到应用内 Agent"
        actions={
          <Button
            variant="primary"
            icon={<IconPlus size={14} />}
            onClick={view === "mcp" ? openCreateMcp : openCreateSkill}
          >
            {view === "mcp" ? "添加 MCP 服务" : "新建 Skill"}
          </Button>
        }
      />

      <div className="mb-5 inline-flex rounded-control border border-line-base bg-surface-fill p-1" role="tablist" aria-label="集成类型">
        <button
          type="button"
          role="tab"
          aria-selected={view === "mcp"}
          onClick={() => setView("mcp")}
          className={`flex h-9 items-center gap-2 rounded-sm px-3 text-body transition-colors ${view === "mcp" ? "bg-brand-500 text-white" : "text-ink-secondary hover:text-ink-primary"}`}
        >
          <IconPlug size={14} /> MCP 服务
          <span className="text-caption opacity-70">{mcpServers.data?.length ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "skills"}
          onClick={() => setView("skills")}
          className={`flex h-9 items-center gap-2 rounded-sm px-3 text-body transition-colors ${view === "skills" ? "bg-brand-500 text-white" : "text-ink-secondary hover:text-ink-primary"}`}
        >
          <IconPuzzle size={14} /> Skills
          <span className="text-caption opacity-70">{skills.data?.length ?? 0}</span>
        </button>
      </div>

      {view === "mcp" ? (
        <div className="space-y-4">
          {mcpServers.error && <ErrorNote message={mcpServers.error} onRetry={() => void mcpServers.reload()} />}
          {toolsError && <ErrorNote message={toolsError} />}
          <Card>
          <CardHeader title="MCP 服务" description={`已配置 ${(mcpServers.data ?? []).filter((server) => server.status !== "deleted").length} 个连接`} />
            {mcpServers.loading ? (
              <div className="space-y-2 px-6 py-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : (mcpServers.data ?? []).filter((server) => server.status !== "deleted").length === 0 ? (
              <div className="p-6">
                <Empty title="尚未接入 MCP 服务" description="连接 MCP 服务后，可发现工具并授权给指定 Agent。" action={<Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreateMcp}>添加 MCP 服务</Button>} />
              </div>
            ) : (
              <Table>
                <thead><tr><Th>服务</Th><Th>传输</Th><Th>地址</Th><Th>密钥引用</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
                <tbody>
                  {(mcpServers.data ?? []).filter((server) => server.status !== "deleted").map((server, index) => (
                    <Tr key={server.id} index={index}>
                      <Td><div className="font-medium">{server.name}</div><div className="mt-0.5 text-caption text-ink-tertiary">{server.id.slice(0, 8)}</div></Td>
                      <Td><span className="rounded-sm bg-surface-fill px-2 py-1 text-caption text-ink-secondary">{server.transport.toUpperCase()}</span></Td>
                      <Td><span className="block max-w-[280px] truncate font-mono text-caption text-ink-secondary">{mcpEndpoint(server)}</span></Td>
                      <Td><span className="font-mono text-caption text-ink-tertiary">{mcpSecretRef(server)}</span></Td>
                      <Td><StatusTag tone={server.status === "active" ? "success" : "default"}>{server.status === "active" ? "已启用" : server.status === "suspended" ? "已暂停" : server.status}</StatusTag></Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="text" loading={busyMcp === server.id} onClick={() => void discoverTools(server)} icon={<IconRefresh size={12} />}>发现工具</Button>
                          <Button size="sm" variant="text" onClick={() => void showTools(server)}>工具</Button>
                          <Button size="sm" variant="text" disabled={server.transport === "stdio"} title={server.transport === "stdio" ? "stdio 服务由受控 Worker 管理" : "编辑服务"} onClick={() => openEditMcp(server)}>编辑</Button>
                          {server.status !== "deleted" && <Button size="sm" variant="text" onClick={() => void toggleMcp(server)}>{server.status === "active" ? "暂停" : "启用"}</Button>}
                          <Button size="sm" variant="text" className="text-state-error-fg hover:bg-state-error-bg" aria-label={`删除 ${server.name}`} onClick={() => void deleteMcp(server)}><IconTrash size={13} /></Button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {selectedServer && (
            <Card>
              <CardHeader title={`${selectedServer.name} · 已发现工具`} description={`${toolsByServer[selectedServer.id]?.length ?? 0} 个工具`} extra={<Button size="sm" variant="text" onClick={() => setToolsServerId(null)}>收起</Button>} />
              {(toolsByServer[selectedServer.id] ?? []).length === 0 ? (
                <div className="px-6 py-5 text-caption text-ink-tertiary">尚未发现可用工具</div>
              ) : (
                <Table>
                  <thead><tr><Th>工具</Th><Th>描述</Th><Th>输入参数</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
                  <tbody>{(toolsByServer[selectedServer.id] ?? []).map((tool, index) => <Tr key={tool.id} index={index}>
                    <Td><span className="font-mono text-caption text-ink-primary">{tool.name}</span></Td>
                    <Td>{tool.description || "—"}</Td>
                    <Td><code className="text-caption text-ink-tertiary">{Object.keys((tool.input_schema.properties as Record<string, unknown> | undefined) ?? {}).join(", ") || "无"}</code></Td>
                    <Td><StatusTag tone={tool.enabled ? "success" : "default"}>{tool.enabled ? "可绑定" : "已停用"}</StatusTag></Td>
                    <Td align="right"><Button size="sm" variant="text" disabled={agents.loading || !agents.data?.length} icon={<IconPlay size={12} />} onClick={() => { setCallingTool({ server: selectedServer, tool }); setCallAgentId(agents.data?.[0]?.id ?? ""); setCallParams("{}"); setCallResult(null); setCallError(null); }}>测试调用</Button></Td>
                  </Tr>)}</tbody>
                </Table>
              )}
            </Card>
          )}
          <Card>
            <CardHeader title="MCP 调用记录" description={`${callLogs.data?.total ?? 0} 条脱敏记录`} extra={<div className="flex items-center gap-2"><Select aria-label="按调用结果筛选" className="h-8 w-[130px]" value={logStatus} onChange={(event) => { setLogStatus(event.target.value as "" | "success" | "error"); setLogPage(1); }}><option value="">全部结果</option><option value="success">成功</option><option value="error">失败</option></Select><Button size="sm" variant="text" icon={<IconRefresh size={12} />} onClick={() => void callLogs.reload()}>刷新</Button></div>} />
            {callLogs.error ? <div className="p-5"><ErrorNote message={callLogs.error} onRetry={() => void callLogs.reload()} /></div> : callLogs.loading ? <div className="space-y-2 px-6 py-4"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div> : (callLogs.data?.items ?? []).length === 0 ? <div className="px-6 py-8 text-center text-caption text-ink-tertiary">暂无 MCP 调用记录</div> : <>
              <Table><thead><tr><Th>时间</Th><Th>Agent</Th><Th>MCP 服务 / 工具</Th><Th>结果</Th><Th align="right">耗时</Th><Th>请求 ID</Th><Th>参数摘要</Th></tr></thead><tbody>{(callLogs.data?.items ?? []).map((log: McpCallLog, index) => {
                const agentName = agents.data?.find((item) => item.id === log.agent_id)?.name ?? log.agent_id.slice(0, 8);
                const serverName = mcpServers.data?.find((item) => item.id === log.mcp_id)?.name ?? log.mcp_id.slice(0, 8);
                return <Tr key={log.id} index={index}><Td><span className="whitespace-nowrap text-caption text-ink-secondary">{new Date(log.created_at).toLocaleString()}</span></Td><Td>{agentName}</Td><Td><span className="block text-caption">{serverName}</span><code className="text-[11px] text-ink-tertiary">{log.tool_id.slice(0, 8)}</code></Td><Td><StatusTag tone={log.status === "success" ? "success" : "error"}>{log.status === "success" ? "成功" : `失败${log.error_code ? ` · ${log.error_code}` : ""}`}</StatusTag></Td><Td align="right">{log.latency_ms} ms</Td><Td><code className="text-caption text-ink-tertiary">{log.request_id ?? "—"}</code></Td><Td><code className="text-caption text-ink-tertiary">{log.input_summary ? `${String(log.input_summary.kind)} · ${String(log.input_summary.items ?? 0)} 项 · ${String(log.input_summary.bytes ?? 0)} B` : "—"}</code></Td></Tr>;
              })}</tbody></Table>
              <div className="flex items-center justify-between border-t border-line-split px-5 py-3 text-caption text-ink-tertiary"><span>第 {callLogs.data?.page ?? logPage} 页 · 共 {callLogs.data?.total ?? 0} 条</span><div className="flex gap-2"><Button size="sm" disabled={logPage <= 1} onClick={() => setLogPage((page) => Math.max(1, page - 1))}>上一页</Button><Button size="sm" disabled={logPage * 20 >= (callLogs.data?.total ?? 0)} onClick={() => setLogPage((page) => page + 1)}>下一页</Button></div></div>
            </>}
          </Card>
          <Card className="px-5 py-4">
            <div className="flex items-start gap-3"><IconAgent size={16} /><div><div className="text-body font-medium text-ink-primary">Agent 授权</div><p className="mt-1 text-caption leading-5 text-ink-tertiary">MCP 服务、发现的工具和 Skills 可在 Agent 编辑窗口中按需绑定。密钥仅通过 `secret_ref` 引用，控制台不会接收或保存密钥明文。</p></div></div>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {skills.error && <ErrorNote message={skills.error} onRetry={() => void skills.reload()} />}
          <Card>
            <CardHeader title="Skills" description={`已注册 ${skills.data?.length ?? 0} 项能力`} />
            {skills.loading ? (
              <div className="space-y-2 px-6 py-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : (skills.data ?? []).length === 0 ? (
              <div className="p-6"><Empty title="尚未注册 Skill" description="添加说明、参数约束与触发条件，供 Agent 按需调用。" action={<Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreateSkill}>新建 Skill</Button>} /></div>
            ) : (
              <Table>
                <thead><tr><Th>名称</Th><Th>说明</Th><Th>触发条件</Th><Th>来源</Th><Th align="right">操作</Th></tr></thead>
                <tbody>{(skills.data ?? []).map((skill, index) => <Tr key={skill.id} index={index}>
                  <Td><div className="font-medium">{skill.name}</div><div className="mt-0.5 text-caption text-ink-tertiary">{skill.id.slice(0, 8)}</div></Td>
                  <Td><span className="block max-w-[300px] truncate text-caption text-ink-secondary">{skill.description || "—"}</span></Td>
                  <Td><code className="text-caption text-ink-tertiary">{skill.trigger ? JSON.stringify(skill.trigger) : "未设置"}</code></Td>
                  <Td><StatusTag tone={skill.source === "builtin" ? "info" : "default"}>{skill.source === "builtin" ? "内置" : "自定义"}</StatusTag></Td>
                  <Td align="right"><div className="flex justify-end gap-1"><Button size="sm" variant="text" icon={<IconPlay size={12} />} onClick={() => { setInvokeSkill(skill); setInvokeParams("{}"); setInvokeResult(null); setInvokeError(null); }}>测试</Button><Button size="sm" variant="text" onClick={() => openEditSkill(skill)}>编辑</Button><Button size="sm" variant="text" className="text-state-error-fg hover:bg-state-error-bg" aria-label={`删除 ${skill.name}`} onClick={() => void deleteSkill(skill)}><IconTrash size={13} /></Button></div></Td>
                </Tr>)}</tbody>
              </Table>
            )}
          </Card>
          <Card className="px-5 py-4"><div className="flex items-start gap-3"><IconBook size={16} /><div><div className="text-body font-medium text-ink-primary">安全执行</div><p className="mt-1 text-caption leading-5 text-ink-tertiary">自定义模块以 WebAssembly 形式上传并在受限沙箱中运行；调用参数会按 Schema 校验。</p></div></div></Card>
        </div>
      )}

      <Modal open={mcpDialog} title={editingMcp ? "编辑 MCP 服务" : "添加 MCP 服务"} onClose={() => setMcpDialog(false)} footer={<><Button onClick={() => setMcpDialog(false)}>取消</Button><Button variant="primary" loading={pending} onClick={() => void saveMcp()}>保存</Button></>}>
        <div className="space-y-4">
          {formError && <ErrorNote message={formError} />}
          <Field label="服务名称" required><Input value={mcpForm.name} onChange={(event) => setMcpForm({ ...mcpForm, name: event.target.value })} placeholder="如：订单查询" /></Field>
          <Field label="传输方式" required>
            <Select value={mcpForm.transport} onChange={(event) => setMcpForm({ ...mcpForm, transport: event.target.value as Transport })}>
              <option value="http">Streamable HTTP</option><option value="sse">SSE</option><option value="stdio" disabled>stdio（受控 Worker 未接入）</option>
            </Select>
          </Field>
          {mcpForm.transport !== "stdio" && <Field label="服务地址" required><Input value={mcpForm.endpoint} onChange={(event) => setMcpForm({ ...mcpForm, endpoint: event.target.value })} placeholder="https://mcp.example.com/mcp" /></Field>}
          <Field label="Bearer 密钥引用" hint="只填密钥管理器中的引用名，例如 MCP_ORDERS_TOKEN；不要粘贴密钥明文。">
            <Input value={mcpForm.secretRef} onChange={(event) => setMcpForm({ ...mcpForm, secretRef: event.target.value.toUpperCase() })} placeholder="MCP_ORDERS_TOKEN" autoComplete="off" />
          </Field>
        </div>
      </Modal>

      <Modal open={skillDialog} title={editingSkill ? "编辑 Skill" : "注册 Skill"} onClose={() => setSkillDialog(false)} width={680} footer={<><Button onClick={() => setSkillDialog(false)}>取消</Button><Button variant="primary" loading={pending} onClick={() => void saveSkill()}>保存 Skill</Button></>}>
        <div className="space-y-4">
          {formError && <ErrorNote message={formError} />}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Field label="名称" required><Input value={skillForm.name} onChange={(event) => setSkillForm({ ...skillForm, name: event.target.value })} /></Field><Field label="说明"><Input value={skillForm.description} onChange={(event) => setSkillForm({ ...skillForm, description: event.target.value })} /></Field></div>
          <Field label="执行说明"><Textarea value={skillForm.instructions} onChange={(event) => setSkillForm({ ...skillForm, instructions: event.target.value })} className="min-h-[100px]" placeholder="描述能力边界、输入输出和注意事项" /></Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Field label="参数 Schema" hint="JSON 对象"><Textarea value={skillForm.paramsSchema} onChange={(event) => setSkillForm({ ...skillForm, paramsSchema: event.target.value })} className="min-h-[112px] font-mono text-caption" placeholder={'{\n  "type": "object",\n  "properties": {}\n}'} /></Field><Field label="触发条件" hint="JSON 对象"><Textarea value={skillForm.trigger} onChange={(event) => setSkillForm({ ...skillForm, trigger: event.target.value })} className="min-h-[112px] font-mono text-caption" placeholder={'{\n  "keywords": ["订单查询"]\n}'} /></Field></div>
          <Field label={editingSkill ? "替换 WASM 模块" : "WASM 模块"} hint={editingSkill ? "留空保留当前模块；最大 256 KiB。也可粘贴 Base64。" : "运行测试需要有效模块；最大 256 KiB。"}>
            <input ref={wasmInputRef} type="file" accept=".wasm,application/wasm" className="hidden" onChange={(event) => void loadWasmFile(event)} />
            <div className="mb-2 flex items-center gap-3"><Button size="sm" icon={<IconPlus size={13} />} onClick={() => wasmInputRef.current?.click()}>选择 WASM 文件</Button><span className="text-caption text-ink-tertiary">模块将在浏览器编码后发送</span></div>
            <Textarea value={skillForm.wasmBase64} onChange={(event) => setSkillForm({ ...skillForm, wasmBase64: event.target.value })} className="min-h-[92px] font-mono text-caption" placeholder="也可以粘贴 Base64" autoComplete="off" />
          </Field>
        </div>
      </Modal>

      <Modal open={Boolean(callingTool)} title={`测试 MCP 工具${callingTool ? ` · ${callingTool.tool.name}` : ""}`} onClose={() => setCallingTool(null)} width={680} footer={<><Button onClick={() => setCallingTool(null)}>取消</Button><Button variant="primary" icon={<IconPlay size={13} />} loading={busyMcp === callingTool?.tool.id} disabled={!agents.data?.length} onClick={() => void runMcpTool()}>执行调用</Button></>}>
        <div className="space-y-4">
          {callError && <ErrorNote message={callError} />}
          <p className="rounded-control border border-state-warning-fg/25 bg-state-warning-bg px-3 py-2 text-caption text-state-warning-fg">此操作会向 MCP 服务发送真实请求。请确认 Agent 授权与参数内容。</p>
          <Field label="调用身份" required>
            <Select value={callAgentId} onChange={(event) => setCallAgentId(event.target.value)}>
              {(agents.data ?? []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.is_default ? " · 默认兜底" : ""}</option>)}
            </Select>
          </Field>
          {callingTool && <Field label="输入 Schema"><pre className="scroll-slim max-h-36 overflow-auto rounded-control border border-line-base bg-surface-fill p-3 text-caption leading-5 text-ink-tertiary">{JSON.stringify(callingTool.tool.input_schema, null, 2)}</pre></Field>}
          <Field label="调用参数" hint="JSON 对象">
            <Textarea value={callParams} onChange={(event) => setCallParams(event.target.value)} className="min-h-[140px] font-mono text-caption" />
          </Field>
          {callResult !== null && <Field label="调用结果"><pre className="scroll-slim max-h-64 overflow-auto rounded-control border border-line-base bg-surface-fill p-3 text-caption leading-5 text-ink-primary">{callResult}</pre></Field>}
        </div>
      </Modal>

      <Modal open={Boolean(invokeSkill)} title={`测试 Skill${invokeSkill ? ` · ${invokeSkill.name}` : ""}`} onClose={() => setInvokeSkill(null)} footer={<><Button onClick={() => setInvokeSkill(null)}>关闭</Button><Button variant="primary" icon={<IconPlay size={13} />} loading={busySkillId === invokeSkill?.id} onClick={() => void runSkill()}>运行</Button></>}>
        <div className="space-y-4">{invokeError && <ErrorNote message={invokeError} />}<Field label="调用参数" hint="JSON 对象"><Textarea value={invokeParams} onChange={(event) => setInvokeParams(event.target.value)} className="min-h-[140px] font-mono text-caption" /></Field>{invokeResult !== null && <Field label="执行结果"><pre className="scroll-slim max-h-64 overflow-auto rounded-control border border-line-base bg-surface-fill p-3 text-caption leading-5 text-ink-primary">{invokeResult}</pre></Field>}</div>
      </Modal>
    </div>
  );
}
