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
  IconHistory,
  IconPlug,
  IconSettings,
  IconSparkle,
} from "./icons";
import { Select, Spinner } from "./ui";

const NAV = [
  { to: "/", label: "概览", icon: IconDashboard, end: true },
  { to: "/workflows", label: "工作流编排", icon: IconGraph },
  { to: "/agents", label: "Agent", icon: IconAgent },
  { to: "/knowledge", label: "知识库", icon: IconBook },
  { to: "/models", label: "模型目录", icon: IconBrain },
  { to: "/integrations", label: "工具与 Skills", icon: IconPlug },
  { to: "/workspace", label: "工作区管理", icon: IconSettings },
  { to: "/playground", label: "对话调试台", icon: IconChat },
  { to: "/conversations", label: "会话记录", icon: IconHistory },
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
  const pageTitle = NAV.find((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))?.label ?? "工作流画布";

  return (
    <div className="console-shell flex h-full min-h-screen bg-[#0b1412]">
      <aside className="console-sidebar flex w-[244px] shrink-0 flex-col border-r border-white/20 bg-[#101914]/90 text-white backdrop-blur-2xl max-md:w-[68px]">
        <motion.div
          className="flex h-[72px] items-center gap-3 border-b border-white/10 px-5 max-md:justify-center max-md:px-0"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.span
            className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px] bg-[#b7f3e2] text-[11px] font-black text-[#10231b] shadow-[0_0_28px_rgba(101,236,208,.24)]"
          >
            <span className="absolute inset-0 bg-white/30" />
            AP
          </motion.span>
          <div className="leading-tight">
            <div className="text-body font-semibold text-white max-md:hidden">Agent Platform</div>
            <div className="text-[10px] tracking-[0.12em] text-white/40 max-md:hidden">AGENT WORKSPACE</div>
          </div>
        </motion.div>

        <nav className="mt-6 flex-1 px-3 max-md:px-2" aria-label="主导航">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                className={
                  "relative mb-1 flex h-10 items-center gap-3 rounded-[7px] px-3 text-body transition-colors duration-150 max-md:justify-center max-md:px-0 " +
                  (active
                    ? "bg-white/12 font-semibold text-[#b7f3e2] ring-1 ring-white/15"
                    : "text-white/55 hover:bg-white/8 hover:text-white")
                }
              >
                {active && (
                  // layoutId 让指示条在导航项之间「滑动」而不是闪现：
                  // 位置关系本身就是导航的心智模型，滑动把这个关系画了出来
                  <motion.span
                    layoutId="nav-active-bar"
                    className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r-full bg-[#8af0c8] shadow-[0_0_12px_rgba(138,240,200,.65)]"
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
                <span className="max-md:hidden">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-4 py-4 max-md:hidden">
          <div className="mb-3 flex items-center justify-between text-[11px] text-white/45">
            <span>RUNTIME</span>
            <span className="font-mono text-white/25">v0.1</span>
          </div>
          <div className="flex items-center gap-2 text-caption text-white/55">
            {/* 三种健康态三种表达：连接成功慢呼吸、掉线同频呼吸但用错误色（吸引注意）、检测中静止 */}
            {health === "ok" ? (
              <BreathingDot className="text-state-success-fg" />
            ) : health === "down" ? (
              <BreathingDot className="text-state-error-fg" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
            )}
            {health === "ok" ? "后端已连接" : health === "down" ? "后端未连接" : "检测中…"}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="console-header flex h-[76px] shrink-0 items-center justify-between gap-4 border-b border-white/55 bg-white/50 px-8 backdrop-blur-2xl max-md:h-auto max-md:min-h-[72px] max-md:flex-wrap max-md:px-4 max-md:py-3">
          {/* 工作区切换是全局状态，首屏一次轻入；之后它一直在，不该反复抢戏 */}
          <motion.div
            className="flex min-w-0 shrink-0 items-center gap-2 text-caption text-white/55 max-md:flex-wrap"
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
                  className="workspace-select h-9 w-[168px] shrink-0 text-caption"
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
                <span className="text-white/25">/</span>
                <Select
                  aria-label="选择应用"
                  className="workspace-select h-9 w-[180px] shrink-0 text-caption"
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
          <div className="ml-auto flex items-center gap-4">
          <span className="hidden text-caption font-medium text-[#d3e5df] md:inline">{pageTitle}</span>
          {error && (
            <FadeSwap id={error}>
              <div className="truncate text-caption text-state-error-fg">{error}</div>
            </FadeSwap>
          )}
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* 滚动进度线：贴着内容区顶部，长页面里给一个「还有多少」的尺子 */}
          <ScrollProgress target={mainRef} />
          <main ref={mainRef} className="console-main scroll-slim min-h-0 flex-1 overflow-y-auto px-8 py-8 max-md:px-4 max-md:py-5">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
