/**
 * 工作流列表：创建、进入画布、查看当前生效版本。
 *
 * 一个应用可以有多个工作流，但只有一个被绑定为默认（application.default_workflow_id）。
 * 列表里明确标出「已绑定」，避免用户改了一个没生效的流程却以为上了线。
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { workflowsApi } from "../lib/api";
import { useAsync } from "../lib/hooks";
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
  Skeleton,
  StatusTag,
  Table,
  Td,
  Th,
  Tr,
  statusText,
  taskTone,
  useToast,
} from "../components/ui";
import { IconGraph, IconPlus, IconTrash } from "../components/icons";

export function WorkflowsPage() {
  const { app } = useWorkspace();
  const appId = app?.id ?? "";
  const toast = useToast();
  const confirm = useConfirm();
  const flows = useAsync(() => workflowsApi.list(appId), [appId], { enabled: Boolean(appId) });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) {
      setFormError("请填写工作流名称");
      return;
    }
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
      };
      if (editing) await workflowsApi.update(appId, editing.id, payload);
      else await workflowsApi.create(appId, payload);
      toast.push(editing ? "工作流设置已更新" : "工作流已创建");
      setOpen(false);
      setEditing(null);
      setName("");
      setDescription("");
      await flows.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (flow: { id: string; name: string; description: string | null }) => {
    setEditing({ id: flow.id, name: flow.name });
    setName(flow.name);
    setDescription(flow.description ?? "");
    setFormError(null);
    setOpen(true);
  };

  const remove = async (id: string, name: string) => {
    if (app?.default_workflow_id === id) {
      toast.push("先将应用切换到其他默认工作流，再删除当前流程", "info");
      return;
    }
    if (!await confirm({ title: "删除工作流", description: `删除「${name}」？该流程将从列表移除，历史版本保留供审计；删除后不能恢复或继续发布。`, confirmLabel: "删除工作流", danger: true })) return;
    try {
      await workflowsApi.remove(appId, id);
      toast.push("工作流已删除");
      await flows.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "删除工作流失败", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="工作流编排"
        description="可视化定义路由与 Agent 拓扑；改完保存后可打版本并发布上线"
        actions={
          <Button
            variant="primary"
            icon={<IconPlus size={14} />}
            onClick={openCreate}
          >
            新建工作流
          </Button>
        }
      />

      {flows.error && (
        <div className="mb-4">
          <ErrorNote message={flows.error} onRetry={() => void flows.reload()} />
        </div>
      )}

      <Card>
        <CardHeader title="工作流" description={`共 ${flows.data?.length ?? 0} 个`} />
        {flows.loading ? (
          <div className="space-y-2 px-6 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (flows.data ?? []).length === 0 ? (
          <div className="p-6">
            <Empty
              title="还没有工作流"
              description="工作流决定「一次对话如何被路由到哪个 Agent」。先创建一个，再进画布连线。"
              action={
                <Button variant="primary" onClick={() => setOpen(true)}>
                  新建工作流
                </Button>
              }
            />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>名称</Th>
                <Th>描述</Th>
                <Th>状态</Th>
                <Th>与应用的绑定</Th>
                <Th align="right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {(flows.data ?? []).map((flow, index) => {
                const bound = app?.default_workflow_id === flow.id;
                return (
                  <Tr key={flow.id} index={index} className="hover:bg-surface-header">
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-50 text-brand-600">
                          <IconGraph size={13} />
                        </span>
                        {flow.name}
                      </div>
                    </Td>
                    <Td>
                      <span className="text-caption text-ink-tertiary">
                        {flow.description || "—"}
                      </span>
                    </Td>
                    <Td>
                      <StatusTag tone={taskTone(flow.status)}>{statusText(flow.status)}</StatusTag>
                    </Td>
                    <Td>
                      {bound ? (
                        <StatusTag tone="success">已绑定应用</StatusTag>
                      ) : (
                        <span className="text-caption text-ink-tertiary">未绑定</span>
                      )}
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        <Link to={`/workflows/${flow.id}`} className="text-caption text-brand-600 hover:underline">打开画布</Link>
                        <Button size="sm" variant="text" onClick={() => openEdit(flow)}>编辑</Button>
                        <Button size="sm" variant="text" disabled={bound} title={bound ? "先切换应用默认工作流" : "删除工作流"} className="text-state-error-fg hover:bg-state-error-bg" aria-label={`删除 ${flow.name}`} onClick={() => void remove(flow.id, flow.name)}><IconTrash size={13} /></Button>
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
        title={editing ? `编辑工作流 · ${editing.name}` : "新建工作流"}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void create()}>
              {editing ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <ErrorNote message={formError} />}
          <Field label="名称" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：主流程"
            />
          </Field>
          <Field label="描述">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="用途说明"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
