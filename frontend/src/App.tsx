/**
 * 应用入口与路由。
 *
 * 首次进入的三种状态在这里收敛（而不是让每个页面各自处理）：
 * 1. 连不上后端 → 明确提示 + 重试，不显示空白页；
 * 2. 没有租户 → 引导创建（控制台是多租户产品，没有租户什么也做不了）；
 * 3. 有租户没应用 → 引导创建应用。
 * 只有三项齐备才渲染具体的业务页面，避免每个页面都写一遍「未选择应用」。
 */

import { useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Shell } from "./components/Shell";
import { PageShell } from "./components/motion";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  Spinner,
  ToastProvider,
  useToast,
} from "./components/ui";
import { AgentsPage } from "./pages/Agents";
import { KnowledgePage } from "./pages/Knowledge";
import { ModelsPage } from "./pages/Models";
import { MotionLabPage } from "./pages/MotionLab";
import { OverviewPage } from "./pages/Overview";
import { PlaygroundPage } from "./pages/Playground";
import { WorkflowEditorPage } from "./pages/WorkflowEditor";
import { WorkflowsPage } from "./pages/Workflows";
import { WorkspaceProvider, useWorkspace } from "./state/workspace";

/** 空状态容器：创建租户 / 创建应用共用同一套版式 */
function SetupCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-layout px-6">
      <Card className="w-full max-w-[480px] px-8 py-8">
        <div className="mb-6">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-caption font-semibold text-white">
              AP
            </span>
            <span className="text-subtitle text-ink-primary">Agent Platform</span>
          </div>
          <h1 className="text-title text-ink-primary">{title}</h1>
          <p className="mt-1.5 text-body text-ink-tertiary">{description}</p>
        </div>
        {children}
      </Card>
    </div>
  );
}

function OnboardingTenant() {
  const { createTenant } = useWorkspace();
  const [name, setName] = useState("演示租户");
  const [slug, setSlug] = useState("demo");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setError(null);
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError("标识只能包含小写字母、数字与连字符");
      return;
    }
    setPending(true);
    try {
      await createTenant(name.trim(), slug.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <SetupCard title="创建第一个租户" description="租户是平台最高层级的隔离单元，后续的应用与数据都挂在它下面。">
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        <Field label="租户名称" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="标识 slug" required hint="用于 URL 与 API，仅小写字母/数字/连字符">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Button variant="primary" className="w-full" loading={pending} onClick={() => void submit()}>
          创建并进入
        </Button>
      </div>
    </SetupCard>
  );
}

function OnboardingApp() {
  const { createApp, tenant } = useWorkspace();
  const [name, setName] = useState("智能客服");
  const [description, setDescription] = useState("面向售后场景的多 Agent 应用");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setError("请填写应用名称");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await createApp(name.trim(), description.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setPending(false);
    }
  };

  return (
    <SetupCard
      title="创建一个应用"
      description={`租户「${tenant?.name ?? ""}」下还没有应用。应用是对话的对外入口，一个租户可以有多个。`}
    >
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        <Field label="应用名称" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="描述">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Button variant="primary" className="w-full" loading={pending} onClick={() => void submit()}>
          创建并进入
        </Button>
      </div>
    </SetupCard>
  );
}

function Routed() {
  const { loading, error, tenants, apps, refresh } = useWorkspace();
  const toast = useToast();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-layout">
        <div className="flex items-center gap-2 text-body text-ink-tertiary">
          <Spinner size={14} /> 正在连接后端…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <SetupCard title="无法连接后端" description="控制台依赖后端 API。请确认服务已启动（默认 http://127.0.0.1:8000）。">
        <div className="space-y-4">
          <ErrorNote message={error} />
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              void refresh();
              toast.push("已重新连接", "info");
            }}
          >
            重试
          </Button>
          <p className="text-caption leading-6 text-ink-tertiary">
            本地启动方式：在 <code className="font-mono">backend</code> 目录执行{" "}
            <code className="font-mono">uv run uvicorn app.main:app --port 8000</code>
          </p>
        </div>
      </SetupCard>
    );
  }

  if (tenants.length === 0) return <OnboardingTenant />;
  if (apps.length === 0) return <OnboardingApp />;

  return (
    <Shell>
      {/*
        mode="wait"：先退场再进场，避免两个页面在过渡期同时占位导致布局跳动。
        initial={false}：首屏不做进场动画，否则「打开就要等一下」的观感很差。
        key 用 pathname：同一页面内的 query/state 变化不触发整页重绘。
      */}
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          <Route
            path="/"
            element={
              <PageShell>
                <OverviewPage />
              </PageShell>
            }
          />
          <Route
            path="/workflows"
            element={
              <PageShell>
                <WorkflowsPage />
              </PageShell>
            }
          />
          <Route
            path="/workflows/:wfId"
            element={
              <PageShell>
                <WorkflowEditorPage />
              </PageShell>
            }
          />
          <Route
            path="/agents"
            element={
              <PageShell>
                <AgentsPage />
              </PageShell>
            }
          />
          <Route
            path="/knowledge"
            element={
              <PageShell>
                <KnowledgePage />
              </PageShell>
            }
          />
          <Route
            path="/models"
            element={
              <PageShell>
                <ModelsPage />
              </PageShell>
            }
          />
          <Route
            path="/playground"
            element={
              <PageShell>
                <PlaygroundPage />
              </PageShell>
            }
          />
          <Route
            path="/motion"
            element={
              <PageShell>
                <MotionLabPage />
              </PageShell>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </Shell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* reducedMotion="user"：系统开了「减少动态效果」时，framer 自动降级为直接跳到终态 */}
      <MotionConfig reducedMotion="user">
        <WorkspaceProvider>
          <ToastProvider>
            <Routed />
          </ToastProvider>
        </WorkspaceProvider>
      </MotionConfig>
    </BrowserRouter>
  );
}
