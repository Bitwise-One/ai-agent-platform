/**
 * Agent 管理：列表 + 新建/编辑（含模型与知识库绑定）。
 *
 * 交互设计要点：
 * 1. **默认 Agent 的唯一性由后端保证**（新建/改默认时会清掉同应用其它默认），
 *    前端只负责把 is_default 传对，不做本地状态推断，避免两边规则不一致；
 * 2. **知识库绑定是覆盖式 PUT**，所以编辑时必须先 GET 回显，否则保存会清空；
 * 3. 关键词直接决定规则路由能否命中，因此表单里给出「逗号分隔」的明确提示，
 *    并在提交前做去空格、去空项，不把脏数据写进库。
 */

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { agentsApi, integrationsApi, knowledgeApi, modelsApi } from "../lib/api";
import { useAsync, useSubmit } from "../lib/hooks";
import { listContainer } from "../lib/motion";
import { popItem } from "../components/motion";
import { useWorkspace } from "../state/workspace";
import {
  Button,
  Card,
  CardHeader,
  useConfirm,
  Empty,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatusTag,
  Switch,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  statusText,
  taskTone,
  useToast,
} from "../components/ui";
import { IconPlug, IconPlus, IconPuzzle, IconTrash } from "../components/icons";
import type { Agent, McpTool } from "../lib/types";

interface FormState {
  name: string;
  system_prompt: string;
  keywords: string;
  temperature: number;
  model_config_id: string;
  is_default: boolean;
  kb_ids: string[];
  mcp_ids: string[];
  mcp_tool_ids: string[];
  skill_ids: string[];
}

interface AgentBindings {
  kb_ids: string[];
  mcp_ids: string[];
  mcp_tool_ids: string[];
  skill_ids: string[];
}

const emptyBindings: AgentBindings = { kb_ids: [], mcp_ids: [], mcp_tool_ids: [], skill_ids: [] };

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

const emptyForm: FormState = {
  name: "",
  system_prompt: "",
  keywords: "",
  temperature: 0.7,
  model_config_id: "",
  is_default: false,
  kb_ids: [],
  mcp_ids: [],
  mcp_tool_ids: [],
  skill_ids: [],
};

export function AgentsPage() {
  const { app, tenant } = useWorkspace();
  const appId = app?.id ?? "";
  const toast = useToast();
  const confirm = useConfirm();

  const agents = useAsync(() => agentsApi.list(appId), [appId], { enabled: Boolean(appId) });
  const models = useAsync(() => modelsApi.list(), [], { enabled: Boolean(appId) });
  const kbs = useAsync(() => knowledgeApi.list(), [], { enabled: Boolean(appId) });
  const mcpServers = useAsync(() => integrationsApi.listMcpServers(), [tenant?.id], { enabled: Boolean(appId && tenant?.id) });
  const skills = useAsync(() => integrationsApi.listSkills(), [tenant?.id], { enabled: Boolean(appId && tenant?.id) });
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);

  const [editing, setEditing] = useState<Agent | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [initialBindings, setInitialBindings] = useState<AgentBindings>(emptyBindings);
  const [formError, setFormError] = useState<string | null>(null);
  const { pending, run } = useSubmit();
  const bindingResourcesLoading = mcpServers.loading || skills.loading;
  const bindingResourcesError = mcpServers.error || skills.error;

  const modelName = useMemo(() => {
    const map = new Map((models.data ?? []).map((m) => [m.id, m]));
    return (id: string | null) => (id ? map.get(id)?.name ?? "已删除的模型" : "网关默认");
  }, [models.data]);

  /**
   * 知识库绑定不在 Agent 列表接口里（多对多单独存），这里为每行补一次 GET。
   * 并发拉取 + 失败降级为空数组：某个 Agent 的绑定读不到不该让整张表报错。
   */
  const [bindings, setBindings] = useState<Record<string, string[]>>({});
  const agentRows = agents.data;
  useEffect(() => {
    const rows = agentRows ?? [];
    if (!appId || rows.length === 0) {
      setBindings({});
      return;
    }
    let alive = true;
    void Promise.all(
      rows.map((agent) =>
        Promise.all([
          agentsApi.boundKbs(appId, agent.id).catch(() => ({ kb_ids: [] as string[] })),
          agentsApi.boundMcpServers(appId, agent.id).catch(() => ({ ids: [] as string[] })),
          agentsApi.boundSkills(appId, agent.id).catch(() => ({ ids: [] as string[] })),
          agentsApi.boundMcpTools(appId, agent.id).catch(() => ({ ids: [] as string[] })),
        ]).then(([kbsResult, mcpResult, skillResult, toolResult]) => [
          agent.id,
          { kb: kbsResult.kb_ids, mcp: mcpResult.ids, skill: skillResult.ids, tools: toolResult.ids },
        ] as const),
      ),
    ).then((entries) => {
      if (alive) {
        setBindings(Object.fromEntries(entries.map(([id, value]) => [id, value.kb])));
      }
    });
    return () => {
      alive = false;
    };
  }, [agentRows, appId]);

  useEffect(() => {
    const servers = (mcpServers.data ?? []).filter((server) => server.status === "active");
    let alive = true;
    void Promise.all(servers.map((server) => integrationsApi.listMcpTools(server.id).catch(() => ({ items: [] as McpTool[] }))))
      .then((responses) => { if (alive) setMcpTools(responses.flatMap((response) => response.items)); });
    return () => { alive = false; };
  }, [mcpServers.data]);

  const kbNames = useMemo(() => {
    const map = new Map((kbs.data ?? []).map((kb) => [kb.id, kb.name]));
    return (ids: string[] | undefined) => (ids ?? []).map((id) => map.get(id) ?? "已删除");
  }, [kbs.data]);

  const openCreate = () => {
    setEditing(null);
    setInitialBindings(emptyBindings);
    setForm({ ...emptyForm, model_config_id: models.data?.[0]?.id ?? "" });
    setFormError(null);
    setOpen(true);
  };

  const openEdit = async (agent: Agent) => {
    setEditing(agent);
    setFormError(null);
    // 先回显绑定，再打开弹窗：避免用户看到空勾选后误保存清空绑定
    let bound = { kb: [] as string[], mcp: [] as string[], skills: [] as string[], tools: [] as string[] };
    try {
      const [kbsResult, mcpResult, skillsResult, toolsResult] = await Promise.all([
        agentsApi.boundKbs(appId, agent.id),
        agentsApi.boundMcpServers(appId, agent.id),
        agentsApi.boundSkills(appId, agent.id),
        agentsApi.boundMcpTools(appId, agent.id),
      ]);
      bound = { kb: kbsResult.kb_ids, mcp: mcpResult.ids, skills: skillsResult.ids, tools: toolsResult.ids };
    } catch {
      toast.push("无法读取 Agent 的资源绑定，请重试后再编辑", "error");
      return;
    }
    setForm({
      name: agent.name,
      system_prompt: agent.system_prompt,
      keywords: agent.keywords.join("、"),
      temperature: agent.temperature,
      model_config_id: agent.model_config_id ?? "",
      is_default: agent.is_default,
      kb_ids: bound.kb,
      mcp_ids: bound.mcp,
      skill_ids: bound.skills,
      mcp_tool_ids: bound.tools,
    });
    setInitialBindings({ kb_ids: bound.kb, mcp_ids: bound.mcp, skill_ids: bound.skills, mcp_tool_ids: bound.tools });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setFormError("请填写 Agent 名称");
      return;
    }
    const keywords = form.keywords
      .split(/[,，、\s]+/)
      .map((k) => k.trim())
      .filter(Boolean);

    const payload = {
      name: form.name.trim(),
      system_prompt: form.system_prompt,
      keywords,
      temperature: Number(form.temperature),
      model_config_id: form.model_config_id || null,
      is_default: form.is_default,
    };

    await run(async () => {
      if (editing) {
        await agentsApi.update(appId, editing.id, payload);
        if (!sameIds(form.kb_ids, initialBindings.kb_ids)) await agentsApi.bindKbs(appId, editing.id, form.kb_ids);
        if (!sameIds(form.mcp_ids, initialBindings.mcp_ids)) await agentsApi.bindMcpServers(appId, editing.id, form.mcp_ids);
        if (!sameIds(form.skill_ids, initialBindings.skill_ids)) await agentsApi.bindSkills(appId, editing.id, form.skill_ids);
        if (!sameIds(form.mcp_tool_ids, initialBindings.mcp_tool_ids)) await agentsApi.bindMcpTools(appId, editing.id, form.mcp_tool_ids);
      } else {
        const created = await agentsApi.create(appId, payload);
        setEditing(created);
        if (form.kb_ids.length) await agentsApi.bindKbs(appId, created.id, form.kb_ids);
        if (form.mcp_ids.length) await agentsApi.bindMcpServers(appId, created.id, form.mcp_ids);
        if (form.skill_ids.length) await agentsApi.bindSkills(appId, created.id, form.skill_ids);
        if (form.mcp_tool_ids.length) await agentsApi.bindMcpTools(appId, created.id, form.mcp_tool_ids);
      }
    });
  };

  const onSubmit = async () => {
    try {
      await submit();
      toast.push(editing ? "已保存修改" : "Agent 已创建");
      setOpen(false);
      await agents.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const remove = async (agent: Agent) => {
    if (agent.is_default) {
      toast.push("默认兜底 Agent 不能删除，请先将其他 Agent 设为默认", "info");
      return;
    }
    if (!await confirm({ title: "删除 Agent", description: `删除「${agent.name}」？系统提示词、知识库和工具绑定将停用；相关历史 trace 保留。`, confirmLabel: "删除 Agent", danger: true })) return;
    try {
      await agentsApi.remove(appId, agent.id);
      toast.push("已删除");
      await agents.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "删除失败", "error");
    }
  };

  const toggleKb = (id: string) => {
    setForm((prev) => ({
      ...prev,
      kb_ids: prev.kb_ids.includes(id)
        ? prev.kb_ids.filter((k) => k !== id)
        : [...prev.kb_ids, id],
    }));
  };

  const toggleBinding = (key: "mcp_ids" | "mcp_tool_ids" | "skill_ids", id: string) => {
    setForm((previous) => {
      const selected = previous[key];
      const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
      if (key === "mcp_ids") {
        const allowedTools = new Set(mcpTools.filter((tool) => next.includes(tool.mcp_id)).map((tool) => tool.id));
        return { ...previous, mcp_ids: next, mcp_tool_ids: previous.mcp_tool_ids.filter((toolId) => allowedTools.has(toolId)) };
      }
      return { ...previous, [key]: next };
    });
  };

  return (
    <div>
      <PageHeader
        title="Agent"
        description="配置 Agent 的提示词、路由与可调用的知识、MCP 工具和 Skills"
        actions={
          <Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreate}>
            新建 Agent
          </Button>
        }
      />

      {agents.error && (
        <div className="mb-4">
          <ErrorNote message={agents.error} onRetry={() => void agents.reload()} />
        </div>
      )}

      <Card>
        <CardHeader title="Agent 列表" description={`共 ${agents.data?.length ?? 0} 个`} />
        {agents.loading ? (
          <div className="space-y-2 px-6 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (agents.data ?? []).length === 0 ? (
          <div className="p-6">
            <Empty
              title="还没有 Agent"
              description="Agent 是真正执行对话的角色。至少创建一个作为默认兜底，路由无命中时会回落到它。"
              action={
                <Button variant="primary" icon={<IconPlus size={14} />} onClick={openCreate}>
                  新建 Agent
                </Button>
              }
            />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>名称</Th>
                <Th>路由关键词</Th>
                <Th>模型</Th>
                <Th>知识库</Th>
                <Th align="right">温度</Th>
                <Th>状态</Th>
                <Th align="right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {(agents.data ?? []).map((agent, index) => (
                <Tr key={agent.id} index={index} className="transition-colors hover:bg-surface-header">
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="text-body text-ink-primary">{agent.name}</span>
                      {agent.is_default && (
                        <StatusTag tone="info">默认兜底</StatusTag>
                      )}
                    </div>
                    <div className="mt-0.5 max-w-[420px] truncate text-caption text-ink-tertiary">
                      {agent.system_prompt || "未设置系统提示词"}
                    </div>
                  </Td>
                  <Td>
                    {agent.keywords.length === 0 ? (
                      <span className="text-caption text-ink-tertiary">—</span>
                    ) : (
                      <motion.div
                        className="flex flex-wrap gap-1"
                        variants={listContainer}
                        initial="initial"
                        animate="animate"
                      >
                        {agent.keywords.slice(0, 4).map((kw) => (
                          <motion.span
                            key={kw}
                            variants={popItem}
                            className="rounded-sm bg-surface-fill px-1.5 py-0.5 text-caption text-ink-secondary"
                          >
                            {kw}
                          </motion.span>
                        ))}
                        {agent.keywords.length > 4 && (
                          <span className="text-caption text-ink-tertiary">
                            +{agent.keywords.length - 4}
                          </span>
                        )}
                      </motion.div>
                    )}
                  </Td>
                  <Td>
                    <span className="text-caption text-ink-secondary">
                      {modelName(agent.model_config_id)}
                    </span>
                  </Td>
                  <Td>
                    {kbNames(bindings[agent.id]).length === 0 ? (
                      <span className="text-caption text-ink-tertiary">未绑定</span>
                    ) : (
                      <motion.div
                        className="flex flex-wrap gap-1"
                        variants={listContainer}
                        initial="initial"
                        animate="animate"
                      >
                        {kbNames(bindings[agent.id]).map((name) => (
                          <motion.span
                            key={name}
                            variants={popItem}
                            className="rounded-sm bg-brand-50 px-1.5 py-0.5 text-caption text-brand-600"
                          >
                            {name}
                          </motion.span>
                        ))}
                      </motion.div>
                    )}
                  </Td>
                  <Td align="right">{agent.temperature.toFixed(1)}</Td>
                  <Td>
                    <StatusTag tone={taskTone(agent.status)}>{statusText(agent.status)}</StatusTag>
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="text" onClick={() => void openEdit(agent)}>
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="text"
                        disabled={agent.is_default}
                        title={agent.is_default ? "先将其他 Agent 设为默认" : "删除 Agent"}
                        className="text-state-error-fg hover:bg-state-error-bg"
                        onClick={() => void remove(agent)}
                        aria-label={`删除 ${agent.name}`}
                      >
                        <IconTrash size={13} />
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `编辑 Agent · ${editing.name}` : "新建 Agent"}
        onClose={() => setOpen(false)}
        width={640}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} disabled={bindingResourcesLoading || Boolean(bindingResourcesError)} onClick={() => void onSubmit()}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <ErrorNote message={formError} />}
          {bindingResourcesLoading && <p className="text-caption text-ink-tertiary">正在读取 MCP 服务与 Skills…</p>}
          {bindingResourcesError && <ErrorNote message={bindingResourcesError} onRetry={() => void Promise.all([mcpServers.reload(), skills.reload()])} />}
          <div className="grid grid-cols-2 gap-4">
            <Field label="名称" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：售后助手"
              />
            </Field>
            <Field label="模型" hint="留空则使用网关默认模型">
              <Select
                value={form.model_config_id}
                onChange={(e) => setForm({ ...form, model_config_id: e.target.value })}
              >
                <option value="">网关默认</option>
                {(models.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}（{m.model_name}）
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="系统提示词" hint="决定 Agent 的角色与回答风格">
            <Textarea
              value={form.system_prompt}
              onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              placeholder="你是……，回答时需要……"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="路由关键词" hint="逗号分隔；命中即走此 Agent">
              <Input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="退货、退款、售后"
              />
            </Field>
            <Field label={`温度 ${form.temperature.toFixed(1)}`} hint="越低越稳定，越高越发散">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                className="mt-2 w-full accent-brand-500"
                aria-label="温度"
              />
            </Field>
          </div>

          <Field label="关联知识库" hint="对话时会检索这些知识库并注入上下文">
            {(kbs.data ?? []).length === 0 ? (
              <p className="text-caption text-ink-tertiary">暂无知识库，可先去「知识库」创建</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(kbs.data ?? []).map((kb) => {
                  const checked = form.kb_ids.includes(kb.id);
                  return (
                    <label
                      key={kb.id}
                      className={
                        "flex cursor-pointer items-center gap-2 rounded-control border px-2.5 py-2 text-body transition-colors " +
                        (checked
                          ? "border-brand-300 bg-brand-50 text-ink-primary"
                          : "border-line-split text-ink-secondary hover:border-brand-200")
                      }
                    >
                      <input
                        type="checkbox"
                        className="accent-brand-500"
                        checked={checked}
                        onChange={() => toggleKb(kb.id)}
                      />
                      <span className="truncate">{kb.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Field>

          <div className="space-y-4 rounded-control border border-line-split bg-surface-fill p-3">
            <div>
              <div className="mb-2 flex items-center gap-2 text-body font-medium text-ink-primary"><IconPlug size={14} /> MCP 服务</div>
              {mcpServers.error ? <p className="text-caption text-state-error-fg">{mcpServers.error}</p> : (mcpServers.data ?? []).filter((server) => server.status !== "deleted").length === 0 ? (
                <p className="text-caption text-ink-tertiary">尚未配置 MCP 服务</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(mcpServers.data ?? []).filter((server) => server.status !== "deleted").map((server) => (
                    <label key={server.id} className="flex cursor-pointer items-center gap-2 rounded-control border border-line-split bg-surface-fill px-2.5 py-2 text-caption text-ink-secondary hover:border-brand-300">
                      <input type="checkbox" className="accent-brand-500" checked={form.mcp_ids.includes(server.id)} onChange={() => toggleBinding("mcp_ids", server.id)} />
                      <span className="min-w-0 flex-1 truncate">{server.name}</span>
                      {server.status !== "active" && <span className="text-[10px] text-state-warning-fg">暂停</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {form.mcp_ids.length > 0 && (
              <div>
                <div className="mb-2 text-caption font-medium text-ink-secondary">允许调用的工具</div>
                {mcpTools.filter((tool) => form.mcp_ids.includes(tool.mcp_id)).length === 0 ? (
                  <p className="text-caption text-ink-tertiary">所选服务尚未发现可用工具，可先在「工具与 Skills」中执行工具发现。</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {mcpTools.filter((tool) => form.mcp_ids.includes(tool.mcp_id)).map((tool) => (
                      <label key={tool.id} className="flex cursor-pointer items-start gap-2 rounded-control border border-line-split bg-surface-fill px-2.5 py-2 hover:border-brand-300">
                        <input type="checkbox" className="mt-0.5 accent-brand-500" checked={form.mcp_tool_ids.includes(tool.id)} onChange={() => toggleBinding("mcp_tool_ids", tool.id)} />
                        <span className="min-w-0"><span className="block truncate font-mono text-caption text-ink-primary">{tool.name}</span><span className="block truncate text-[11px] text-ink-tertiary">{tool.description || "MCP 工具"}</span></span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center gap-2 text-body font-medium text-ink-primary"><IconPuzzle size={14} /> Skills</div>
              {skills.error ? <p className="text-caption text-state-error-fg">{skills.error}</p> : (skills.data ?? []).length === 0 ? (
                <p className="text-caption text-ink-tertiary">尚未注册 Skill</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(skills.data ?? []).map((skill) => (
                    <label key={skill.id} className="flex cursor-pointer items-center gap-2 rounded-control border border-line-split bg-surface-fill px-2.5 py-2 text-caption text-ink-secondary hover:border-brand-300">
                      <input type="checkbox" className="accent-brand-500" checked={form.skill_ids.includes(skill.id)} onChange={() => toggleBinding("skill_ids", skill.id)} />
                      <span className="min-w-0 flex-1 truncate">{skill.name}</span>
                      <span className="text-[10px] text-ink-tertiary">{skill.source === "builtin" ? "内置" : "自定义"}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-control bg-surface-fill px-3 py-2.5">
            <div>
              <div className="text-body text-ink-primary">设为默认 Agent</div>
              <div className="text-caption text-ink-tertiary">
                路由全部未命中时回落到它；一个应用只保留一个默认
              </div>
            </div>
            <Switch
              checked={form.is_default}
              onChange={(next) => setForm({ ...form, is_default: next })}
              label="设为默认 Agent"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
