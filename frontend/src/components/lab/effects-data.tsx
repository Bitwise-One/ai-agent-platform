/**
 * 数据与结构组：描边折线、柱状生长、删除塌陷、滑移指示器。
 *
 * 这一组动的是「数据的形状」。原则只有一条：**变化要有方向**。
 * 折线从左往右画、柱子从下往上长、删除的行向左塌、指示器沿排列顺序滑动——
 * 方向感让用户预判下一步，动效才不是噪音。
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { EASE } from "../../lib/motion";
import { Sparkline } from "../motion";

/* ---------------------------------------------------------------- 折线描边 */

const WINDOW = 14;

function nextSeries(prev: number[]): number[] {
  const last = prev[prev.length - 1] ?? 40;
  const drift = (Math.random() - 0.45) * 18;
  const next = Math.max(8, Math.min(96, last + drift));
  return [...prev.slice(-(WINDOW - 1)), Math.round(next)];
}

export function SparklineDemo() {
  const reduce = useReducedMotion();
  const [series, setSeries] = useState<number[]>([32, 41, 38, 52, 47, 58, 55, 66, 61, 72, 69, 78, 74, 86]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => setSeries((prev) => nextSeries(prev)), 2400);
    return () => window.clearInterval(timer);
  }, [reduce]);

  const d = useMemo(() => buildPath(series), [series]);
  const latest = series[series.length - 1];

  return (
    <div className="flex h-full w-full flex-col justify-center gap-3 px-5" data-lab="sparkline">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-caption text-ink-tertiary">近 14 天调用量</div>
          <div className="tabular text-metric text-ink-primary">{latest}k</div>
        </div>
        <span className="text-[11px] text-state-success-fg">+12.4%</span>
      </div>

      <svg viewBox="0 0 180 56" preserveAspectRatio="none" className="w-full" style={{ height: 56 }}>
        <defs>
          <linearGradient id="lab-spark-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9C6BC9" stopOpacity={0.26} />
            <stop offset="100%" stopColor="#9C6BC9" stopOpacity={0} />
          </linearGradient>
        </defs>

        <motion.path
          key={`area-${tick}`}
          d={`${d} L 176 52 L 4 52 Z`}
          fill="url(#lab-spark-area)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        />

        {/* 描边自绘：pathLength 0 → 1，长度不同的路径都能自动归一化 */}
        <motion.path
          d={d}
          fill="none"
          stroke="#7644A7"
          strokeWidth={2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1, d }}
          transition={{ pathLength: { duration: 1.1, ease: EASE }, d: { duration: 0.7, ease: EASE } }}
        />
      </svg>

      <button
        type="button"
        onClick={() => {
          setSeries((prev) => nextSeries(prev));
          setTick((n) => n + 1);
        }}
        className="self-start rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        推进一天
      </button>
    </div>
  );
}

/** 把数值序列映射成 SVG 折线（与 Sparkline 内部同一套坐标逻辑，独立写一份便于演示变更） */
function buildPath(series: number[]): string {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const stepX = 172 / Math.max(1, series.length - 1);
  return series
    .map((value, index) => {
      const x = 4 + index * stepX;
      const y = 6 + (1 - (value - min) / span) * 40;
      return `${index === 0 ? "M" : "L"} ${Math.round(x)} ${Math.round(y)}`;
    })
    .join(" ");
}

/* ---------------------------------------------------------------- 柱状生长 */

const BARS = [
  { label: "意图路由", value: 82 },
  { label: "知识检索", value: 64 },
  { label: "工具调用", value: 47 },
  { label: "模型生成", value: 93 },
  { label: "审核拦截", value: 28 },
];

export function BarGrowDemo() {
  const reduce = useReducedMotion();
  const [round, setRound] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="flex h-full w-full flex-col justify-center gap-4 px-5" data-lab="bar">
      <div className="flex h-[92px] items-end justify-between gap-2">
        {BARS.map((bar, index) => (
          <button
            key={bar.label}
            type="button"
            onPointerEnter={() => setHover(index)}
            onPointerLeave={() => setHover(null)}
            className="group flex flex-1 flex-col items-center justify-end gap-1.5"
            aria-label={`${bar.label} ${bar.value}`}
          >
            <span className="tabular text-[10px] text-ink-tertiary">
              {hover === index ? `${bar.value}%` : ""}
            </span>
            <motion.span
              key={`${round}-${bar.label}`}
              data-bar={bar.label}
              className="w-full origin-bottom rounded-t-sm"
              style={{
                height: 72,
                background:
                  hover === index
                    ? "linear-gradient(to top, #63398C, #9C6BC9)"
                    : "linear-gradient(to top, #7644A7, #B995DC)",
              }}
              initial={reduce ? { scaleY: 1 } : { scaleY: 0 }}
              animate={{ scaleY: bar.value / 100 }}
              transition={{ duration: reduce ? 0 : 0.72, ease: EASE, delay: reduce ? 0 : index * 0.06 }}
              whileHover={reduce ? undefined : { scaleY: Math.min(1, bar.value / 100 + 0.06) }}
            />
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-tertiary">从底部长出 · 逐根错峰 60ms</span>
        <button
          type="button"
          onClick={() => setRound((n) => n + 1)}
          className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          重播
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 删除塌陷 */

const INITIAL_ROWS = [
  { id: 1, name: "refund-router", note: "退款意图路由" },
  { id: 2, name: "kb-retriever", note: "知识库检索" },
  { id: 3, name: "reply-writer", note: "答复生成" },
  { id: 4, name: "guard-critic", note: "合规审核" },
];

/**
 * 删除塌陷：被删的行向左收起并塌掉高度，剩下的行用 layout 平滑补位。
 *
 * 直接 `filter` 掉数据会让列表「跳」一下——用户会怀疑是不是自己点错了。
 * 让被删的那一行自己飞走，因果关系才闭合。
 */
export function ListCollapseDemo() {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState(INITIAL_ROWS);
  const [seed, setSeed] = useState(0);

  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-5" data-lab="collapse">
      <ul className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.li
              key={row.id}
              layout={!reduce}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 34 }}
              exit={{ opacity: 0, height: 0, x: -14, marginBottom: -6 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
              className="flex items-center justify-between overflow-hidden rounded-control border border-line-split bg-surface px-2.5 text-caption"
            >
              <span className="truncate">
                <span className="font-mono text-[11px] text-ink-primary">{row.name}</span>
                <span className="ml-2 text-ink-tertiary">{row.note}</span>
              </span>
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((one) => one.id !== row.id))}
                className="shrink-0 rounded-sm px-1 text-[11px] text-ink-tertiary transition-colors hover:text-[#CF1322]"
              >
                移除
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-tertiary">{rows.length} 个节点</span>
        <button
          type="button"
          onClick={() => {
            setRows(INITIAL_ROWS);
            setSeed((n) => n + 1);
          }}
          className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          重置 {seed > 0 ? `(${seed})` : ""}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 滑移指示器 */

const TABS = ["近 1 小时", "近 24 小时", "近 7 天"] as const;

/**
 * 滑移指示器：一条 layoutId 的胶囊在标签之间滑动。
 *
 * 位置关系本身就是「这是一组互斥选项」的心智模型，
 * 滑动把这个关系画了出来；换成淡入淡出，用户就读不到「同一个控件」。
 */
export function TabSlideDemo() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);

  const rows = useMemo(
    () => Array.from({ length: 3 }, (_, i) => 34 + active * 8 + i * 11),
    [active],
  );

  return (
    <div className="flex h-full w-full flex-col justify-center gap-4 px-5" data-lab="tab">
      <div className="inline-flex self-start rounded-control bg-surface-fill p-0.5">
        {TABS.map((tab, index) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActive(index)}
            className={
              "relative rounded-sm px-2.5 py-1 text-caption transition-colors " +
              (active === index ? "text-brand-600" : "text-ink-tertiary hover:text-ink-secondary")
            }
          >
            {active === index && (
              <motion.span
                layoutId="lab-tab-pill"
                data-tab-pill="1"
                className="absolute inset-0 rounded-sm bg-surface shadow-card"
                transition={
                  reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 38, mass: 0.7 }
                }
              />
            )}
            <span className="relative z-10">{tab}</span>
          </button>
        ))}
      </div>

      {/* 柱子固定在底部基线之上：宽度收窄才读得出「这是一组柱状」，铺满会被当成色块 */}
      <div className="flex h-[66px] items-end gap-3 border-b border-line-split pl-1">
        {rows.map((value, index) => (
          <motion.span
            key={`${active}-${index}`}
            data-tab-bar={index}
            className="w-7 rounded-t-sm bg-brand-300"
            style={{ height: value, transformOrigin: "bottom" }}
            initial={reduce ? { scaleY: 1, opacity: 1 } : { scaleY: 0.15, opacity: 0.35 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.44, ease: EASE, delay: reduce ? 0 : index * 0.06 }}
          />
        ))}
      </div>
    </div>
  );
}
