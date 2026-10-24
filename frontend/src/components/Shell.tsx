/**
 * 控制台骨架：左侧导航 + 顶部工作区切换 + 内容区。
 *
 * 布局取舍：
 * - 侧边栏固定 216px：够放下中文导航项，又不至于挤压画布（工作流页面需要横向空间）；
 * - 顶部只放「当前在哪个租户/应用」这一件全局信息，页面标题交给各页自己渲染，
 *   避免出现「面包屑 + 页面标题 + 卡片标题」三层重复；
 * - 后端连接状态做成常驻小圆点：本地开发时最常见的故障就是后端没起，
 *   放在界面上比看控制台报错快得多。
 */

import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { useWorkspace } from "../state/workspace";
import { BreathingDot } from "./motion";
import {
  IconAgent,
  IconBook,
  IconBrain,
  IconChat,
  IconDashboard,
  IconGraph,
} from "./icons";
import { Select, Spinner } from "./ui";

const NAV = [
  { to: "/", label: "概览", icon: IconDashboard, end: true },
  { to: "/workflows", label: "工作流编排", icon: IconGraph },
  { to: "/agents", label: "Agent", icon: IconAgent },
  { to: "/knowledge", label: "知识库", icon: IconBook },
  { to: "/models", label: "模型目录", icon: IconBrain },
  { to: "/playground", label: "对话调试台", icon: IconChat },
];

function useHealth(): "ok" | "down" | "checking" {
  const [state, setState] = useState<"ok" | "down" | "checking">("checking");

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const res = await fetch("/health");
        if (!alive) return;
        setState(res.ok ? "ok" : "down");
      } catch {
        if (alive) setState("down");
      }
    };
    void ping();
    // 30s 轮询：足够发现「服务挂了」，又不至于刷请求
    const timer = window.setInterval(ping, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}

export function Shell({ children }: { children: ReactNode }) {
  const { tenants, apps, tenant, app, loading, selectTenant, selectApp, error } = useWorkspace();
  const health = useHealth();
  const location = useLocation();

  return (
    <div className="flex h-full min-h-screen bg-surface-layout">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line-split bg-surface">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-caption font-semibold text-white">
            AP
          </span>
          <div className="leading-tight">
            <div className="text-body font-medium text-ink-primary">Agent Platform</div>
            <div className="text-[11px] text-ink-tertiary">编排控制台</div>
          </div>
        </div>

        <nav className="mt-2 flex-1 px-2" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={
                  "relative mb-0.5 flex h-9 items-center gap-2.5 rounded-control px-3 text-body transition-colors duration-150 " +
                  (active
                    ? "bg-brand-50 font-medium text-brand-600"
                    : "text-ink-secondary hover:bg-surface-fill hover:text-ink-primary")
                }
              >
                {active && (
                  // layoutId 让指示条在导航项之间「滑动」而不是闪现：
                  // 位置关系本身就是导航的心智模型，滑动把这个关系画了出来
                  <motion.span
                    layoutId="nav-active-bar"
                    className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand-500"
                    transition={{ type: "spring", stiffness: 520, damping: 40 }}
                  />
                )}
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-line-split px-4 py-3">
          <div className="flex items-center gap-2 text-caption text-ink-tertiary">
            {health === "ok" ? (
              <BreathingDot className="text-state-success-fg" />
            ) : (
              <span
                className={
                  "h-1.5 w-1.5 rounded-full " +
                  (health === "down" ? "bg-state-error-fg" : "bg-ink-tertiary")
                }
              />
            )}
            {health === "ok" ? "后端已连接" : health === "down" ? "后端未连接" : "检测中…"}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line-split bg-surface px-6">
          <div className="flex shrink-0 items-center gap-2 text-caption text-ink-tertiary">
            <span className="whitespace-nowrap">工作区</span>
            {loading ? (
              <Spinner size={12} />
            ) : (
              <>
                <Select
                  aria-label="选择租户"
                  className="h-7 w-[168px] shrink-0 text-caption"
                  value={tenant?.id ?? ""}
                  onChange={(e) => selectTenant(e.target.value)}
                  disabled={tenants.length === 0}
                >
                  {tenants.length === 0 && <option value="">（无租户）</option>}
                  {tenants.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.slug}
                    </option>
                  ))}
                </Select>
                <span className="text-line-base">/</span>
                <Select
                  aria-label="选择应用"
                  className="h-7 w-[180px] shrink-0 text-caption"
                  value={app?.id ?? ""}
                  onChange={(e) => selectApp(e.target.value)}
                  disabled={apps.length === 0}
                >
                  {apps.length === 0 && <option value="">（无应用）</option>}
                  {apps.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>

          {error && (
            <div className="truncate text-caption text-[#CF1322]">{error}</div>
          )}
        </header>

        <main className="scroll-slim min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
