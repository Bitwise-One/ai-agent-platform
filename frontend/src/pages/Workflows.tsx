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
  statusText,
  taskTone,
  useToast,
} from "../components/ui";
import { IconGraph, IconPlus } from "../components/icons";

export function WorkflowsPage() {
  const { app } = useWorkspace();
  const appId = app?.id ?? "";
  const toast = useToast();
  const flows = useAsync(() => workflowsApi.list(appId), [appId], { enabled: Boolean(appId) });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) {
      setFormError("请填写工作流名称");
      return;
    }
    try {
      await workflowsApi.create(appId, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast.push("工作流已创建");
      setOpen(false);
      setName("");
      setDescription("");
      await flows.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建失败");
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
            onClick={() => {
              setFormError(null);
              setOpen(true);
            }}
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
              {(flows.data ?? []).map((flow) => {
                const bound = app?.default_workflow_id === flow.id;
                return (
                  <tr key={flow.id} className="hover:bg-surface-header">
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
                      <Link
                        to={`/workflows/${flow.id}`}
                        className="text-caption text-brand-600 hover:underline"
                      >
                        打开画布
                      </Link>
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
        title="新建工作流"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void create()}>
              创建
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
