import { useState } from "react";

import { appsApi, tenantsApi, workflowsApi } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useWorkspace } from "../state/workspace";
import {
  Button,
  Card,
  useConfirm,
  Empty,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusTag,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from "../components/ui";
import { IconPlus, IconTrash } from "../components/icons";
import type { Application, Tenant, Workflow } from "../lib/types";

type DialogState =
  | { kind: "tenant"; tenant: Tenant | null }
  | { kind: "app"; app: Application | null }
  | null;

export function WorkspacePage() {
  const { tenants, tenant, apps, app, refresh, selectApp, selectTenant } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantStatus, setTenantStatus] = useState("active");
  const [tenantQuota, setTenantQuota] = useState("{}");
  const [appName, setAppName] = useState("");
  const [appDescription, setAppDescription] = useState("");
  const [appStatus, setAppStatus] = useState("active");
  const [defaultWorkflowId, setDefaultWorkflowId] = useState("");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const workflowState = useAsync(() => workflowsApi.list(app?.id ?? ""), [app?.id], { enabled: Boolean(app?.id) });

  const editTenant = (item: Tenant) => {
    setDialog({ kind: "tenant", tenant: item });
    setTenantName(item.name);
    setTenantSlug(item.slug);
    setTenantStatus(item.status);
    setTenantQuota(JSON.stringify(item.quota ?? {}, null, 2));
    setFormError(null);
  };

  const createTenant = () => {
    setDialog({ kind: "tenant", tenant: null });
    setTenantName("");
    setTenantSlug("");
    setTenantStatus("active");
    setTenantQuota("{}");
    setFormError(null);
  };

  const editApp = async (item: Application | null) => {
    setFormError(null);
    setAppName(item?.name ?? "");
    setAppDescription(item?.description ?? "");
    setAppStatus(item?.status ?? "active");
    setDefaultWorkflowId(item?.default_workflow_id ?? "");
    setWorkflows([]);
    setDialog({ kind: "app", app: item });
    if (item) {
      try {
        setWorkflows(await workflowsApi.list(item.id));
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "无法读取应用工作流");
      }
    }
  };

  const saveTenant = async () => {
    if (!dialog || dialog.kind !== "tenant" || !tenantName.trim() || !tenantSlug.trim()) {
      setFormError("租户名称与标识均为必填");
      return;
    }
    if (!/^[a-z0-9-]+$/.test(tenantSlug.trim())) {
      setFormError("租户标识只能使用小写字母、数字和连字符");
      return;
    }
    if (dialog.tenant?.status === "active" && tenantStatus !== "active" && tenants.filter((item) => item.status === "active").length <= 1) {
      setFormError("平台至少需要保留一个启用租户");
      return;
    }
    let quota: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(tenantQuota);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      quota = parsed as Record<string, unknown>;
    } catch {
      setFormError("配额必须是 JSON 对象");
      return;
    }
    setPending(true);
    try {
      let createdId: string | null = null;
      if (dialog.tenant) await tenantsApi.update(dialog.tenant.id, { name: tenantName.trim(), status: tenantStatus, quota });
      else createdId = (await tenantsApi.create(tenantName.trim(), tenantSlug.trim(), quota)).id;
      setDialog(null);
      await refresh();
      if (createdId) selectTenant(createdId);
      toast.push(dialog.tenant ? "租户设置已更新" : "租户已创建");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  };

  const saveApp = async () => {
    if (!appName.trim()) {
      setFormError("应用名称不能为空");
      return;
    }
    setPending(true);
    try {
      let createdId: string | null = null;
      if (dialog?.kind === "app" && dialog.app) {
        await appsApi.update(dialog.app.id, {
          name: appName.trim(),
          description: appDescription.trim() || null,
          status: appStatus,
          default_workflow_id: defaultWorkflowId || null,
        });
      } else {
        createdId = (await appsApi.create(appName.trim(), appDescription.trim() || undefined)).id;
      }
      setDialog(null);
      await refresh();
      if (createdId) selectApp(createdId);
      toast.push(dialog?.kind === "app" && dialog.app ? "应用设置已更新" : "应用已创建");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  };

  const removeApp = async (item: Application) => {
    if (!await confirm({ title: "删除应用", description: `删除「${item.name}」？应用将停止接收对话，历史数据保留用于审计。`, confirmLabel: "删除应用", danger: true })) return;
    try {
      await appsApi.remove(item.id);
      await refresh();
      toast.push("应用已删除");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "删除应用失败", "error");
    }
  };

  const removeTenant = async (item: Tenant) => {
    if (item.status === "active" && tenants.filter((tenantItem) => tenantItem.status === "active").length <= 1) {
      toast.push("至少保留一个启用租户；如需停用，请先启用其他租户", "info");
      return;
    }
    if (!await confirm({ title: "删除租户", description: `软删除「${item.name}」及其全部应用访问入口？数据保留，但该租户下所有 API 请求都会被拒绝。此操作不可从控制台恢复。`, confirmLabel: "删除租户", danger: true })) return;
    try {
      await tenantsApi.remove(item.id);
      await refresh();
      toast.push("租户已软删除");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "删除租户失败", "error");
    }
  };

  return (
    <div>
      <PageHeader title="工作区管理" description="管理租户、应用入口与默认工作流" actions={<div className="flex gap-2"><Button icon={<IconPlus size={14} />} onClick={createTenant}>新建租户</Button><Button variant="primary" icon={<IconPlus size={14} />} onClick={() => void editApp(null)}>新建应用</Button></div>} />

      <section className="mb-7">
        <div className="mb-3 flex items-baseline justify-between"><h2 className="text-subtitle font-semibold text-ink-primary">租户</h2><span className="text-caption text-ink-tertiary">{tenants.length} 个隔离空间</span></div>
        <Card>
          {tenants.length === 0 ? <div className="p-5"><Empty title="暂无租户" description="租户是平台的最高级数据隔离边界。" /></div> : <Table>
            <thead><tr><Th>名称</Th><Th>标识</Th><Th>应用数</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
            <tbody>{tenants.map((item, index) => <Tr key={item.id} index={index}>
              <Td><span className="font-medium">{item.name}</span>{item.id === tenant?.id && <span className="ml-2 text-[11px] text-brand-300">当前</span>}</Td>
              <Td><code className="text-caption text-ink-tertiary">{item.slug}</code></Td>
              <Td>{item.id === tenant?.id ? apps.length : "—"}</Td>
              <Td><StatusTag tone={item.status === "active" ? "success" : "warning"}>{item.status === "active" ? "启用" : "暂停"}</StatusTag></Td>
              <Td align="right"><div className="flex justify-end gap-1"><Button size="sm" variant="text" onClick={() => editTenant(item)}>设置</Button><Button size="sm" variant="text" className="text-state-error-fg hover:bg-state-error-bg" title="软删除租户" aria-label={`删除租户 ${item.name}`} disabled={item.status === "active" && tenants.filter((tenantItem) => tenantItem.status === "active").length <= 1} onClick={() => void removeTenant(item)}><IconTrash size={13} /></Button></div></Td>
            </Tr>)}</tbody>
          </Table>}
        </Card>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between"><h2 className="text-subtitle font-semibold text-ink-primary">应用</h2><span className="text-caption text-ink-tertiary">{tenant?.name ?? "未选租户"} · {apps.length} 个入口</span></div>
        <Card>
          {!tenant ? <div className="p-5"><Empty title="先选择租户" /></div> : apps.length === 0 ? <div className="p-5"><Empty title="该租户下暂无应用" action={<Button variant="primary" icon={<IconPlus size={14} />} onClick={() => void editApp(null)}>新建应用</Button>} /></div> : <Table>
            <thead><tr><Th>应用</Th><Th>描述</Th><Th>默认工作流</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
            <tbody>{apps.map((item, index) => {
              const selectedFlow = item.id === app?.id ? workflowState.data?.find((flow) => flow.id === item.default_workflow_id) : undefined;
              return <Tr key={item.id} index={index}>
                <Td><span className="font-medium">{item.name}</span>{item.id === app?.id && <span className="ml-2 text-[11px] text-brand-300">当前</span>}</Td>
                <Td><span className="block max-w-[300px] truncate text-caption text-ink-secondary">{item.description || "—"}</span></Td>
                <Td>{selectedFlow?.name ?? (item.default_workflow_id ? item.default_workflow_id.slice(0, 8) : "未绑定")}</Td>
                <Td><StatusTag tone={item.status === "active" ? "success" : "warning"}>{item.status === "active" ? "启用" : "暂停"}</StatusTag></Td>
                <Td align="right"><div className="flex justify-end gap-1">{item.id !== app?.id && <Button size="sm" variant="text" onClick={() => selectApp(item.id)}>切换</Button>}<Button size="sm" variant="text" onClick={() => void editApp(item)}>编辑</Button><Button size="sm" variant="text" className="text-state-error-fg hover:bg-state-error-bg" title="软删除应用" aria-label={`删除应用 ${item.name}`} onClick={() => void removeApp(item)}><IconTrash size={13} /></Button></div></Td>
              </Tr>;
            })}</tbody>
          </Table>}
        </Card>
      </section>

      <Modal open={dialog?.kind === "tenant"} title={dialog?.kind === "tenant" ? dialog.tenant ? `租户设置 · ${dialog.tenant.name}` : "新建租户" : "租户设置"} onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)}>取消</Button><Button variant="primary" loading={pending} onClick={() => void saveTenant()}>{dialog?.kind === "tenant" && dialog.tenant ? "保存" : "创建"}</Button></>}>
        <div className="space-y-4">{formError && <ErrorNote message={formError} />}<Field label="租户名称" required><Input value={tenantName} onChange={(event) => setTenantName(event.target.value)} /></Field>{dialog?.kind === "tenant" && !dialog.tenant && <Field label="租户标识" required hint="小写字母、数字和连字符；创建后不可更改"><Input value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value.toLowerCase())} /></Field>}{dialog?.kind === "tenant" && dialog.tenant && <Field label="状态"><Select value={tenantStatus} onChange={(event) => setTenantStatus(event.target.value)}><option value="active">启用</option><option value="suspended">暂停全部租户请求</option></Select></Field>}<Field label="配额" hint="JSON 对象；各类上限字段由平台策略读取"><Textarea value={tenantQuota} onChange={(event) => setTenantQuota(event.target.value)} className="min-h-[110px] font-mono text-caption" /></Field></div>
      </Modal>

      <Modal open={dialog?.kind === "app"} title={dialog?.kind === "app" ? dialog.app ? `编辑应用 · ${dialog.app.name}` : "新建应用" : "应用"} onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)}>取消</Button><Button variant="primary" loading={pending} onClick={() => void saveApp()}>保存</Button></>}>
        <div className="space-y-4">{formError && <ErrorNote message={formError} />}<Field label="应用名称" required><Input value={appName} onChange={(event) => setAppName(event.target.value)} /></Field><Field label="描述"><Textarea value={appDescription} onChange={(event) => setAppDescription(event.target.value)} /></Field>{dialog?.kind === "app" && dialog.app && <><Field label="状态"><Select value={appStatus} onChange={(event) => setAppStatus(event.target.value)}><option value="active">启用</option><option value="suspended">暂停</option></Select></Field><Field label="默认工作流" hint="停用或解绑后，应用不再有默认执行入口"><Select value={defaultWorkflowId} onChange={(event) => setDefaultWorkflowId(event.target.value)}><option value="">不绑定</option>{workflows.filter((flow) => flow.status !== "archived").map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}</Select></Field></>}</div>
      </Modal>
    </div>
  );
}
