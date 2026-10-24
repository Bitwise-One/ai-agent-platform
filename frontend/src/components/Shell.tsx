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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { useWorkspace } from "../state/workspace";
import { BreathingDot, FadeSwap, ScrollProgress } from "./motion";
import {
  IconAgent,
  IconBook,
  IconBrain,
  IconChat,
  IconDashboard,
  IconGraph,
  IconSparkle,
} from "./icons";
import { Select, Spinner } from "./ui";

const NAV = [
  { to: "/", label: "概览", icon: IconDashboard, end: true },
  { to: "/workflows", label: "工作流编排", icon: IconGraph },
  { to: "/agents", label: "Agent", icon: IconAgent },
  { to: "/knowledge", label: "知识库", icon: IconBook },
  { to: "/models", label: "模型目录", icon: IconBrain },
  { to: "/playground", label: "对话调试台", icon: IconChat },
  { to: "/motion", label: "动效实验室", icon: IconSparkle },
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
  // 控制台是内层滚动容器，滚动进度必须挂在它身上（window 永远不滚）
  const mainRef = useRef<HTMLElement>(null);

  return (
    <div className="flex h-full min-h-screen bg-surface-layout">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line-split bg-surface">
        <motion.div
          className="flex h-14 items-center gap-2.5 px-5"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-caption font-semibold text-white">
            AP
          </span>
          <div className="leading-tight">
            <div className="text-body font-medium text-ink-primary">Agent Platform</div>
            <div className="text-[11px] text-ink-tertiary">编排控制台</div>
          </div>
        </motion.div>

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
                <motion.span
                  className="inline-flex"
                  // 图标微动：选中时放大 6%，悬停时再轻挑一下——导航的"被指到"感从这里来
                  animate={active ? { scale: 1.06 } : { scale: 1 }}
                  whileHover={{ scale: 1.12, y: -1 }}
                  transition={{ type: "spring", stiffness: 460, damping: 26, mass: 0.6 }}
                >
                  <Icon size={16} />
                </motion.span>
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-line-split px-4 py-3">
          <div className="flex items-center gap-2 text-caption text-ink-tertiary">
            {/* 三种健康态三种表达：连接成功慢呼吸、掉线同频呼吸但用错误色（吸引注意）、检测中静止 */}
            {health === "ok" ? (
              <BreathingDot className="text-state-success-fg" />
            ) : health === "down" ? (
              <BreathingDot className="text-state-error-fg" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-ink-tertiary" />
            )}
            {health === "ok" ? "后端已连接" : health === "down" ? "后端未连接" : "检测中…"}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line-split bg-surface px-6">
          {/* 工作区切换是全局状态，首屏一次轻入；之后它一直在，不该反复抢戏 */}
          <motion.div
            className="flex shrink-0 items-center gap-2 text-caption text-ink-tertiary"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
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
          </motion.div>

          {/* 错误信息换内容时淡出淡入：原地替换文本会「跳」 */}
          {error && (
            <FadeSwap id={error}>
              <div className="truncate text-caption text-[#CF1322]">{error}</div>
            </FadeSwap>
          )}
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* 滚动进度线：贴着内容区顶部，长页面里给一个「还有多少」的尺子 */}
          <ScrollProgress target={mainRef} />
          <main ref={mainRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
