/**
 * 概览页：一眼看清「这个应用现在有什么、跑得怎么样」。
 *
 * 信息层级遵循「KPI 在前、明细在后」：先四个数字回答规模问题，
 * 再用两栏分别说明编排现状与接入能力。不在这里堆图表——
 * 真正需要趋势时会去可观测性页面（M6），概览页保持扫描友好。
 */

import { Link } from "react-router-dom";

import { agentsApi, knowledgeApi, modelsApi, workflowsApi } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useWorkspace } from "../state/workspace";
import { Card, CardHeader, ErrorNote, PageHeader, Skeleton, StatusTag, statusText, taskTone } from "../components/ui";
import { IconArrowRight, IconBook, IconGraph } from "../components/icons";

function Metric({
  label,
  value,
  suffix,
  loading,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  loading?: boolean;
}) {
  return (
    <Card className="px-6 py-5">
      <div className="text-caption text-ink-secondary">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        {loading ? (
          <Skeleton className="h-7 w-12" />
        ) : (
          <>
            <span className="tabular text-metric text-ink-primary">{value}</span>
            {suffix && <span className="text-caption text-ink-tertiary">{suffix}</span>}
          </>
        )}
      </div>
    </Card>
  );
}

export function OverviewPage() {
  const { app } = useWorkspace();
  const appId = app?.id ?? "";
  const enabled = Boolean(appId);

  const agents = useAsync(() => agentsApi.list(appId), [appId], { enabled });
  const flows = useAsync(() => workflowsApi.list(appId), [appId], { enabled });
  const models = useAsync(() => modelsApi.list(), [], { enabled });
  const kbs = useAsync(() => knowledgeApi.list(), [], { enabled });

  const docStats = useAsync(
    async () => {
      const list = kbs.data ?? [];
      const counts = await Promise.all(
        list.map((kb) => knowledgeApi.documents(kb.id).then((docs) => docs.length)),
      );
      return counts.reduce((sum, n) => sum + n, 0);
    },
    [kbs.data],
    { enabled: enabled && Boolean(kbs.data) },
  );

  const loading = agents.loading || flows.loading || models.loading || kbs.loading;
  const error = agents.error || flows.error || models.error || kbs.error;

  return (
    <div>
      <PageHeader
        title="概览"
        description={app ? `${app.name} · 编排与接入现状` : "尚未选择应用"}
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} onRetry={() => void agents.reload()} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Agent 数量" value={agents.data?.length ?? 0} loading={loading} />
        <Metric label="工作流" value={flows.data?.length ?? 0} loading={loading} />
        <Metric label="知识库" value={kbs.data?.length ?? 0} loading={loading} />
        <Metric
          label="已入库文档"
          value={docStats.data ?? 0}
          suffix="篇"
          loading={docStats.loading}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="编排现状"
            description="工作流与 Agent 的当前形态"
            extra={
              <Link
                to="/workflows"
                className="flex items-center gap-1 text-caption text-brand-600 hover:underline"
              >
                去编排 <IconArrowRight size={12} />
              </Link>
            }
          />
          <div className="px-6 py-4">
            {flows.loading ? (
              <Skeleton className="h-24 w-full" />
            ) : (flows.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-caption text-ink-tertiary">
                还没有工作流，去「工作流编排」创建一个
              </p>
            ) : (
              <ul className="divide-y divide-line-split">
                {(flows.data ?? []).map((flow) => (
                  <li key={flow.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-control bg-brand-50 text-brand-600">
                        <IconGraph size={14} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-body text-ink-primary">{flow.name}</div>
                        <div className="truncate text-caption text-ink-tertiary">
                          {flow.description || "未填写描述"}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <StatusTag tone={taskTone(flow.status)}>{statusText(flow.status)}</StatusTag>
                      <Link
                        to={`/workflows/${flow.id}`}
                        className="text-caption text-brand-600 hover:underline"
                      >
                        打开画布
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="接入能力" description="模型与知识库" />
          <div className="space-y-4 px-6 py-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-caption text-ink-secondary">
                <span className="flex items-center gap-1.5">
                  <IconBook size={13} /> 知识库
                </span>
                <Link to="/knowledge" className="text-brand-600 hover:underline">
                  管理
                </Link>
              </div>
              <ul className="space-y-1.5">
                {(kbs.data ?? []).slice(0, 3).map((kb) => (
                  <li
                    key={kb.id}
                    className="flex items-center justify-between rounded-control bg-surface-fill px-2.5 py-1.5 text-caption"
                  >
                    <span className="truncate text-ink-primary">{kb.name}</span>
                    <span className="text-ink-tertiary">{kb.vector_dim ?? "-"} 维</span>
                  </li>
                ))}
                {(kbs.data ?? []).length === 0 && (
                  <li className="text-caption text-ink-tertiary">暂无知识库</li>
                )}
              </ul>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-caption text-ink-secondary">
                <span>模型目录</span>
                <Link to="/models" className="text-brand-600 hover:underline">
                  管理
                </Link>
              </div>
              <ul className="space-y-1.5">
                {(models.data ?? []).slice(0, 3).map((model) => (
                  <li
                    key={model.id}
                    className="flex items-center justify-between rounded-control bg-surface-fill px-2.5 py-1.5 text-caption"
                  >
                    <span className="truncate text-ink-primary">{model.name}</span>
                    <span className="font-mono text-[11px] text-ink-tertiary">
                      {model.model_name}
                    </span>
                  </li>
                ))}
                {(models.data ?? []).length === 0 && (
                  <li className="text-caption text-ink-tertiary">暂无模型配置</li>
                )}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
