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

import { useEffect, useMemo, useState } from "react";

import { agentsApi, knowledgeApi, modelsApi } from "../lib/api";
import { useAsync, useSubmit } from "../lib/hooks";
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
import { IconPlus, IconTrash } from "../components/icons";
import type { Agent } from "../lib/types";

interface FormState {
  name: string;
  system_prompt: string;
  keywords: string;
  temperature: number;
  model_config_id: string;
  is_default: boolean;
  kb_ids: string[];
}

const emptyForm: FormState = {
  name: "",
  system_prompt: "",
  keywords: "",
  temperature: 0.7,
  model_config_id: "",
  is_default: false,
  kb_ids: [],
};

export function AgentsPage() {
  const { app } = useWorkspace();
  const appId = app?.id ?? "";
  const toast = useToast();

  const agents = useAsync(() => agentsApi.list(appId), [appId], { enabled: Boolean(appId) });
  const models = useAsync(() => modelsApi.list(), [], { enabled: Boolean(appId) });
  const kbs = useAsync(() => knowledgeApi.list(), [], { enabled: Boolean(appId) });

  const [editing, setEditing] = useState<Agent | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const { pending, run } = useSubmit();

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
        agentsApi
          .boundKbs(appId, agent.id)
          .then((res) => [agent.id, res.kb_ids] as const)
          .catch(() => [agent.id, [] as string[]] as const),
      ),
    ).then((entries) => {
      if (alive) setBindings(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [agentRows, appId]);

  const kbNames = useMemo(() => {
    const map = new Map((kbs.data ?? []).map((kb) => [kb.id, kb.name]));
    return (ids: string[] | undefined) => (ids ?? []).map((id) => map.get(id) ?? "已删除");
  }, [kbs.data]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, model_config_id: models.data?.[0]?.id ?? "" });
    setFormError(null);
    setOpen(true);
  };

  const openEdit = async (agent: Agent) => {
    setEditing(agent);
    setFormError(null);
    // 先回显绑定，再打开弹窗：避免用户看到空勾选后误保存清空绑定
    let bound: string[] = [];
    try {
      bound = (await agentsApi.boundKbs(appId, agent.id)).kb_ids;
    } catch {
      bound = [];
    }
    setForm({
      name: agent.name,
      system_prompt: agent.system_prompt,
      keywords: agent.keywords.join("、"),
      temperature: agent.temperature,
      model_config_id: agent.model_config_id ?? "",
      is_default: agent.is_default,
      kb_ids: bound,
    });
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
        await agentsApi.bindKbs(appId, editing.id, form.kb_ids);
      } else {
        const created = await agentsApi.create(appId, payload);
        await agentsApi.bindKbs(appId, created.id, form.kb_ids);
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
    if (!window.confirm(`确认删除「${agent.name}」？该操作会同时解绑其知识库。`)) return;
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

  return (
    <div>
      <PageHeader
        title="Agent"
        description="应用内的智能体：提示词、模型、知识库与路由关键词"
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
                      <div className="flex flex-wrap gap-1">
                        {agent.keywords.slice(0, 4).map((kw) => (
                          <span
                            key={kw}
                            className="rounded-sm bg-surface-fill px-1.5 py-0.5 text-caption text-ink-secondary"
                          >
                            {kw}
                          </span>
                        ))}
                        {agent.keywords.length > 4 && (
                          <span className="text-caption text-ink-tertiary">
                            +{agent.keywords.length - 4}
                          </span>
                        )}
                      </div>
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
                      <div className="flex flex-wrap gap-1">
                        {kbNames(bindings[agent.id]).map((name) => (
                          <span
                            key={name}
                            className="rounded-sm bg-brand-50 px-1.5 py-0.5 text-caption text-brand-600"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
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
                        className="text-[#CF1322] hover:bg-[#FFF1F0]"
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
            <Button variant="primary" loading={pending} onClick={() => void onSubmit()}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <ErrorNote message={formError} />}
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
                className="mt-2 w-full accent-[#7644A7]"
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
                        className="accent-[#7644A7]"
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
