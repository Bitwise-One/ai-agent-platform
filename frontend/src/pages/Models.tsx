/**
 * 模型目录：租户可选模型的清单与连通性探测。
 *
 * 关键认知：这里的记录**不包含密钥**。真实凭据由部署环境注入，
 * 因此控制台能做的事是「登记有哪些模型」和「探测这个模型名能不能用」，
 * 而不是「填 API Key」。页面上要明确这一点，否则运维会找不到填密钥的地方。
 */

import { useState } from "react";

import { modelsApi } from "../lib/api";
import { useAsync, useSubmit } from "../lib/hooks";
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
  Skeleton,
  StatusTag,
  Table,
  Td,
  Th,
  useToast,
} from "../components/ui";
import { IconPlus, IconPlay, IconTrash } from "../components/icons";
import type { ModelConfig, ModelProbeResult } from "../lib/types";

interface FormState {
  name: string;
  provider: string;
  model_name: string;
  context_len: string;
  price_in: string;
  price_out: string;
}

const emptyForm: FormState = {
  name: "",
  provider: "openai_compat",
  model_name: "",
  context_len: "128000",
  price_in: "",
  price_out: "",
};

function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ModelsPage() {
  const toast = useToast();
  const models = useAsync(() => modelsApi.list(), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ModelProbeResult>>({});
  const { pending, run } = useSubmit();

  const create = async () => {
    if (!form.name.trim() || !form.model_name.trim()) {
      setFormError("名称与模型 ID 均为必填");
      return;
    }
    try {
      await run(async () => {
        await modelsApi.create({
          name: form.name.trim(),
          provider: form.provider,
          model_name: form.model_name.trim(),
          context_len: numOrNull(form.context_len),
          price_in: numOrNull(form.price_in),
          price_out: numOrNull(form.price_out),
          capabilities: {},
        });
      });
      toast.push("模型配置已创建");
      setOpen(false);
      setForm(emptyForm);
      await models.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    }
  };

  const probe = async (model: ModelConfig) => {
    try {
      const result = await modelsApi.probe(model.id);
      setProbes((prev) => ({ ...prev, [model.id]: result }));
      if (result.ok && result.ready) toast.push(`${model.name} 连通正常（${result.latency_ms}ms）`);
      else if (result.ok) toast.push("链路可用，但当前部署未接入真实模型（走 mock）", "info");
      else toast.push(result.detail ?? "探测失败", "error");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "探测失败", "error");
    }
  };

  const remove = async (model: ModelConfig) => {
    if (!window.confirm(`确认删除模型配置「${model.name}」？引用它的 Agent 会回落到网关默认模型。`))
      return;
    try {
      await modelsApi.remove(model.id);
      toast.push("已删除");
      await models.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "删除失败", "error");
    }
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
            onClick={() => {
              setForm(emptyForm);
              setFormError(null);
              setOpen(true);
            }}
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
                <Th align="right">上下文</Th>
                <Th align="right">输入单价</Th>
                <Th align="right">输出单价</Th>
                <Th>连通性</Th>
                <Th align="right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {(models.data ?? []).map((model) => {
                const probeResult = probes[model.id];
                return (
                  <tr key={model.id} className="transition-colors hover:bg-surface-header">
                    <Td>{model.name}</Td>
                    <Td>
                      <span className="font-mono text-caption text-ink-secondary">
                        {model.model_name}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-caption text-ink-tertiary">{model.provider}</span>
                    </Td>
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
                      {probeResult ? (
                        <div className="flex items-center gap-2">
                          <StatusTag tone={probeResult.ok ? "success" : "error"}>
                            {probeResult.ok ? "可用" : "失败"}
                          </StatusTag>
                          <span className="text-caption text-ink-tertiary">
                            {probeResult.latency_ms}ms
                            {!probeResult.ready && " · mock"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-caption text-ink-tertiary">未探测</span>
                      )}
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
                        <Button
                          size="sm"
                          variant="text"
                          className="text-[#CF1322] hover:bg-[#FFF1F0]"
                          aria-label={`删除 ${model.name}`}
                          onClick={() => void remove(model)}
                        >
                          <IconTrash size={13} />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        title="新增模型配置"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={() => void create()}>
              创建
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
            <Field label="协议适配器">
              <Input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="openai_compat"
              />
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
        </div>
      </Modal>
    </div>
  );
}
