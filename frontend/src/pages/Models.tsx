/**
 * 模型目录：租户可选模型的清单与连通性探测。
 *
 * 模型元数据与 write-only BYOK 凭据分开保存；密钥只在输入与提交期间留在内存中。
 */

import { useState } from "react";
import { motion } from "framer-motion";

import { modelsApi } from "../lib/api";
import { useAsync, useSubmit } from "../lib/hooks";
import { Flash } from "../components/motion";
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
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from "../components/ui";
import { IconPlus, IconPlay, IconTrash } from "../components/icons";
import type { ModelConfig, ModelProbeResult } from "../lib/types";

/** 探测结果 + 落地时间戳：时间戳只用于触发「刚更新」的高亮，不参与展示 */
interface ProbeState extends ModelProbeResult {
  at: number;
}

interface FormState {
  name: string;
  provider: string;
  model_name: string;
  context_len: string;
  price_in: string;
  price_out: string;
  base_url: string;
}

const emptyForm: FormState = {
  name: "",
  provider: "openai_compat",
  model_name: "",
  context_len: "128000",
  price_in: "",
  price_out: "",
  base_url: "",
};

function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ModelsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const models = useAsync(() => modelsApi.list(), []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [credential, setCredential] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  const { pending, run } = useSubmit();

  const create = async () => {
    if (!form.name.trim() || !form.model_name.trim()) {
      setFormError("名称与模型 ID 均为必填");
      return;
    }
    try {
      let savedId = editing?.id ?? "";
      await run(async () => {
        const payload = {
          name: form.name.trim(),
          provider: form.provider,
          model_name: form.model_name.trim(),
          context_len: numOrNull(form.context_len),
          price_in: numOrNull(form.price_in),
          price_out: numOrNull(form.price_out),
          base_url: form.base_url.trim() || null,
          capabilities: {},
        };
        const saved = editing ? await modelsApi.update(editing.id, payload) : await modelsApi.create(payload);
        savedId = saved.id;
      });
      await models.reload();
      if (credential.trim()) {
        try {
          await run(() => modelsApi.setCredential(savedId, credential.trim()));
        } catch (error) {
          setCredential("");
          setFormError(`模型信息已保存，但 API Key 未保存：${error instanceof Error ? error.message : "凭据写入失败"}`);
          await models.reload();
          return;
        }
      }
      toast.push(editing ? "模型配置已更新" : "模型配置已创建");
      setOpen(false);
      setForm(emptyForm);
      setEditing(null);
      setCredential("");
      await models.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    }
  };

  const closeModal = () => {
    setOpen(false);
    setCredential("");
    setFormError(null);
  };

  const probe = async (model: ModelConfig) => {
    try {
      const result = await modelsApi.probe(model.id);
      setProbes((prev) => ({ ...prev, [model.id]: { ...result, at: Date.now() } }));
      if (result.ok && result.ready) toast.push(`${model.name} 连通正常（${result.latency_ms}ms）`);
      else if (result.ok) toast.push("链路可用，但当前部署未接入真实模型（走 mock）", "info");
      else toast.push(result.detail ?? "探测失败", "error");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "探测失败", "error");
    }
  };

  const remove = async (model: ModelConfig) => {
    if (!await confirm({ title: "删除模型配置", description: `删除「${model.name}」？仍引用它的 Agent 会阻止删除，请先为这些 Agent 重新绑定模型。`, confirmLabel: "删除", danger: true })) return;
    try {
      await modelsApi.remove(model.id);
      toast.push("已删除");
      await models.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "删除失败", "error");
    }
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm); setCredential(""); setFormError(null); setOpen(true); };
  const openEdit = (model: ModelConfig) => {
    setEditing(model);
    setCredential("");
    setForm({ name: model.name, provider: model.provider, model_name: model.model_name, context_len: String(model.context_len ?? ""), price_in: String(model.price_in ?? ""), price_out: String(model.price_out ?? ""), base_url: model.base_url ?? "" });
    setFormError(null);
    setOpen(true);
  };
  const clearCredential = async (model: ModelConfig) => {
    if (!await confirm({ title: "清除模型密钥", description: `清除「${model.name}」的专属 API Key 后，调用将回退到部署级凭据；若部署级凭据未配置，模型将不可用。`, confirmLabel: "清除密钥", danger: true })) return;
    try { await modelsApi.clearCredential(model.id); toast.push("模型密钥已清除"); await models.reload(); } catch (err) { toast.push(err instanceof Error ? err.message : "清除失败", "error"); }
  };

  return (
    <div>
      <PageHeader
        title="模型目录"
        description="登记可用模型与单价；真实密钥由部署环境注入，不在此处填写"
        actions={
          <Button
            variant="primary"
            icon={<IconPlus size={14} />}
            onClick={openCreate}
          >
            新增模型
          </Button>
        }
      />

      {models.error && (
        <div className="mb-4">
          <ErrorNote message={models.error} onRetry={() => void models.reload()} />
        </div>
      )}

      <Card>
        <CardHeader title="模型清单" description={`共 ${models.data?.length ?? 0} 条`} />
        {models.loading ? (
          <div className="space-y-2 px-6 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (models.data ?? []).length === 0 ? (
          <div className="p-6">
            <Empty
              title="还没有模型配置"
              description="登记一个模型后，Agent 才能选用它；不登记时全部走网关默认模型。"
              action={
                <Button variant="primary" onClick={() => setOpen(true)}>
                  新增模型
                </Button>
              }
            />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>名称</Th>
                <Th>模型 ID</Th>
                <Th>协议</Th>
                <Th>API 地址</Th>
                <Th>API Key</Th>
                <Th align="right">上下文</Th>
                <Th align="right">输入单价</Th>
                <Th align="right">输出单价</Th>
                <Th>连通性</Th>
                <Th align="right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {(models.data ?? []).map((model, index) => {
                const probeResult = probes[model.id];
                return (
                  <Tr key={model.id} index={index} className="transition-colors hover:bg-surface-header">
                <Td><div>{model.name}</div><div className="mt-0.5 text-[11px] text-ink-tertiary">{model.api_key_configured ? "已配置专属密钥" : "使用部署级密钥"}</div></Td>
                    <Td>
                      <span className="font-mono text-caption text-ink-secondary">
                        {model.model_name}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-caption text-ink-tertiary">{model.provider}</span>
                    </Td>
                    <Td><span className="block max-w-56 truncate font-mono text-[11px] text-ink-tertiary" title={model.base_url ?? "部署默认地址"}>{model.base_url || "部署默认地址"}</span></Td>
                    <Td><StatusTag tone={model.api_key_configured ? "success" : "default"}>{model.api_key_configured ? "专属密钥" : "部署默认"}</StatusTag></Td>
                    <Td align="right">
                      {model.context_len ? model.context_len.toLocaleString() : "—"}
                    </Td>
                    <Td align="right">
                      {model.price_in != null ? `¥${model.price_in}` : "—"}
                    </Td>
                    <Td align="right">
                      {model.price_out != null ? `¥${model.price_out}` : "—"}
                    </Td>
                    <Td>
                      {/* 探测结果落表时整格高亮一闪：延迟数字会变，但「刚测完」这件事不标记就会漏掉 */}
                      <Flash value={probeResult?.at ?? 0} className="-mx-1 rounded-control px-1 py-1.5">
                        {probeResult ? (
                          <motion.div
                            className="flex items-center gap-2"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ type: "spring", stiffness: 520, damping: 26, mass: 0.5 }}
                          >
                            <StatusTag tone={probeResult.ok ? "success" : "error"}>
                              {probeResult.ok ? "可用" : "失败"}
                            </StatusTag>
                            <span className="text-caption text-ink-tertiary">
                              {probeResult.latency_ms}ms
                              {!probeResult.ready && " · mock"}
                            </span>
                          </motion.div>
                        ) : (
                          <span className="text-caption text-ink-tertiary">未探测</span>
                        )}
                      </Flash>
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="text"
                          icon={<IconPlay size={12} />}
                          onClick={() => void probe(model)}
                        >
                          探测
                        </Button>
                        <Button size="sm" variant="text" onClick={() => openEdit(model)}>编辑</Button>
                        {model.api_key_configured && <Button size="sm" variant="text" onClick={() => void clearCredential(model)}>清除密钥</Button>}
                        <Button
                          size="sm"
                          variant="text"
                          className="text-state-error-fg hover:bg-state-error-bg"
                          aria-label={`删除 ${model.name}`}
                          onClick={() => void remove(model)}
                        >
                          <IconTrash size={13} />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `编辑模型配置 · ${editing.name}` : "新增模型配置"}
        onClose={closeModal}
        footer={
          <>
            <Button onClick={closeModal}>取消</Button>
            <Button variant="primary" loading={pending} onClick={() => void create()}>
              {editing ? "保存修改" : "创建"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <ErrorNote message={formError} />}
          <div className="grid grid-cols-2 gap-4">
            <Field label="展示名称" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：主力模型"
              />
            </Field>
            <Field label="模型 ID" required hint="厂商侧的模型名，如 gpt-4o-mini">
              <Input
                value={form.model_name}
                onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                placeholder="gpt-4o-mini"
              />
            </Field>
            <Field label="协议适配器" hint="当前网关支持 OpenAI-compatible API">
              <Select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                <option value="openai_compat">OpenAI-compatible</option>
              </Select>
            </Field>
            <Field label="兼容 API 地址" hint="留空继承部署配置；必须为 HTTPS 公网地址">
              <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.example.com/v1" />
            </Field>
            <Field label="上下文长度">
              <Input
                value={form.context_len}
                onChange={(e) => setForm({ ...form, context_len: e.target.value })}
                placeholder="128000"
              />
            </Field>
            <Field label="输入单价" hint="每 1K token，用于成本估算">
              <Input
                value={form.price_in}
                onChange={(e) => setForm({ ...form, price_in: e.target.value })}
                placeholder="0.00015"
              />
            </Field>
            <Field label="输出单价">
              <Input
                value={form.price_out}
                onChange={(e) => setForm({ ...form, price_out: e.target.value })}
                placeholder="0.0006"
              />
            </Field>
          </div>
          <Field label="供应商 API Key" hint={editing?.api_key_configured ? "已配置。留空保持不变；输入新值会轮换密钥。密钥不会回显。" : "只写入加密存储，不会回显或进入日志。"}>
            <Input type="password" autoComplete="new-password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder={editing?.api_key_configured ? "留空保持当前密钥" : "sk-…"} />
          </Field>
          <p className="text-caption leading-5 text-ink-tertiary">密钥只会在本次请求中发送，并由服务器使用 CREDENTIAL_ENCRYPTION_KEY 加密保存。若租户工作区尚未配置该主密钥，保存会被拒绝；不会降级成明文存储。</p>
        </div>
      </Modal>
    </div>
  );
}
