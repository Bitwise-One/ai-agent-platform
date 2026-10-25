/**
 * 结构组：动的是「数据的形状」。
 *
 * 原则只有一条：变化要有方向。折线从左往右画、柱子从下往上长、
 * 列表向左塌、指示器沿排列顺序滑——方向感让用户预判下一步，
 * 动效才不是噪音。
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 环形图 */

const DONUT = [
  { label: "路由", value: 42, color: "#0D7665" },
  { label: "检索", value: 28, color: "#39B69A" },
  { label: "生成", value: 20, color: "#86DCC1" },
  { label: "其他", value: 10, color: "#E4D5F2" },
];

/** 环形图：四段弧依次画出，累计偏移让它们天然拼成一个圆 */
export function DonutChart() {
  const reduce = useReducedMotion();
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex h-full w-full items-center justify-center gap-4" data-lab="donut">
      <div className="relative h-24 w-24">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 80 80">
          {DONUT.map((slice) => {
            const length = (slice.value / 100) * circumference;
            const dash = `${length} ${circumference - length}`;
            const currentOffset = -offset;
            offset += length;
            return (
              <motion.circle
                key={slice.label}
                cx="40"
                cy="40"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={12}
                strokeDasharray={dash}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: currentOffset }}
                transition={{ duration: reduce ? 0 : 0.85, ease: EASE }}
                style={{ transformOrigin: "center" }}
              />
            );
          })}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-caption text-ink-tertiary">占比</span>
      </div>
      <ul className="space-y-1">
        {DONUT.map((slice) => (
          <li key={slice.label} className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
            <span className="h-2 w-2 rounded-sm" style={{ background: slice.color }} />
            {slice.label}
            <span className="tabular text-ink-tertiary">{slice.value}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- 仪表盘 */

/** 仪表盘：指针用 spring 打到目标角度，过冲一点点再稳住（阻尼调低就有） */
export function GaugeMeter() {
  const reduce = useReducedMotion();
  const [target, setTarget] = useState(68);
  const angle = -120 + (target / 100) * 240;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="gauge">
      <div className="relative h-20 w-40 overflow-hidden">
        <svg viewBox="0 0 160 80" className="h-full w-full">
          <path d="M 16 68 A 64 64 0 0 1 144 68" fill="none" stroke="#34453D" strokeWidth={10} strokeLinecap="round" />
          <motion.path
            d="M 16 68 A 64 64 0 0 1 144 68"
            fill="none"
            stroke="#0D7665"
            strokeWidth={10}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: target / 100 }}
            transition={{ duration: reduce ? 0 : 0.8, ease: EASE }}
          />
        </svg>
        <motion.span
          className="absolute bottom-0 left-1/2 h-14 w-0.5 origin-bottom rounded bg-ink-primary"
          animate={{ rotate: angle }}
          transition={{ type: "spring", stiffness: 180, damping: 12, mass: 0.7 }}
        />
        <span className="absolute bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-ink-primary" />
      </div>
      <div className="flex gap-2">
        {[28, 68, 95].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setTarget(n)}
            className="rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 热力图 */

/** 热力图：格子按对角线错峰淡入，hover 时单格放大并显值 */
export function HeatmapGrid() {
  const [hover, setHover] = useState<number | null>(null);
  const cells = useMemo(
    () => Array.from({ length: 28 }, (_, i) => ({ i, level: (i * 7) % 5 })),
    [],
  );
  const shades = ["#EEF9F3", "#DDF7EB", "#B7F3E2", "#86DCC1", "#39B69A"];

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="heatmap">
      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ i, level }) => (
          <motion.button
            key={i}
            className="h-4 w-4 rounded-sm"
            style={{ background: shades[level] }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: hover === i ? 1.35 : 1 }}
            transition={{ duration: 0.3, ease: EASE, delay: (i % 7) * 0.03 + Math.floor(i / 7) * 0.03 }}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            aria-label={`第 ${i + 1} 格，等级 ${level}`}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 树图生长 */

/** 树图生长：外块先落位，内块随后展开，模拟"先分桶再装数据" */
export function TreemapGrow() {
  const reduce = useReducedMotion();
  const blocks = [
    { label: "知识库", w: "58%", color: "#0D7665" },
    { label: "Agent", w: "38%", color: "#39B69A" },
    { label: "模型", w: "38%", color: "#86DCC1" },
    { label: "其他", w: "58%", color: "#B7F3E2" },
  ];

  return (
    <div className="flex h-full w-full flex-col justify-center gap-1 px-5" data-lab="treemap">
      <div className="flex h-9 gap-1">
        {blocks.slice(0, 2).map((block, index) => (
          <motion.div
            key={block.label}
            className="flex items-center justify-center rounded-sm text-[11px] text-white"
            style={{ width: block.w, background: block.color }}
            initial={reduce ? { scaleY: 1 } : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: reduce ? 0 : 0.5, ease: EASE, delay: index * 0.1 }}
          >
            {block.label}
          </motion.div>
        ))}
      </div>
      <div className="flex h-9 gap-1">
        {blocks.slice(2).map((block, index) => (
          <motion.div
            key={block.label}
            className="flex items-center justify-center rounded-sm text-[11px] text-white"
            style={{ width: block.w, background: block.color }}
            initial={reduce ? { scaleY: 1 } : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: reduce ? 0 : 0.5, ease: EASE, delay: 0.2 + index * 0.1 }}
          >
            {block.label}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 表格排序 */

/** 表格排序 FLIP：只改数据顺序，位置补间全部交给 layout */
export function SortFlip() {
  const [asc, setAsc] = useState(true);
  const rows = [
    { id: 1, name: "refund-router", calls: 1286 },
    { id: 2, name: "kb-retriever", calls: 942 },
    { id: 3, name: "reply-writer", calls: 1873 },
    { id: 4, name: "guard-critic", calls: 415 },
  ];
  const sorted = [...rows].sort((a, b) => (asc ? a.calls - b.calls : b.calls - a.calls));

  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-5" data-lab="sort">
      <button
        type="button"
        onClick={() => setAsc((v) => !v)}
        className="self-end rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary"
      >
        按调用量 {asc ? "升序" : "降序"}
      </button>
      <ul className="divide-y divide-line-split rounded-control border border-line-split bg-surface">
        {sorted.map((row) => (
          <motion.li
            key={row.id}
            layout
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="flex items-center justify-between px-2.5 py-1.5 text-caption"
          >
            <span className="font-mono text-[11px] text-ink-primary">{row.name}</span>
            <span className="tabular text-ink-tertiary">{row.calls}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- 分页滑动 */

/** 分页滑动：换页时新内容从右侧推入、旧内容左移退场，方向即"往后翻" */
export function PageSlide() {
  const [page, setPage] = useState(0);
  const pages = ["第一页 · 概览", "第二页 · 明细", "第三页 · 日志"];
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="pageslide">
      <div className="relative h-12 w-40 overflow-hidden rounded-control border border-line-split bg-surface">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={page}
            className="absolute inset-0 flex items-center justify-center text-caption text-ink-primary"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 40 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -40 }}
            transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
          >
            {pages[page]}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary"
        >
          上一页
        </button>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(2, p + 1))}
          className="rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary"
        >
          下一页
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- KPI 翻牌 */

/** KPI 翻牌：每位数字绕底边翻一下，比整体淡入更能看出"是哪一位在变" */
export function KpiFlip() {
  const [value, setValue] = useState(1286);
  const digits = String(value).split("");

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="kpiflip">
      <div className="flex overflow-hidden" style={{ perspective: 600 }}>
        {digits.map((digit, index) => (
          <motion.span
            key={`${index}-${digit}`}
            className="tabular text-metric font-semibold text-ink-primary"
            style={{ transformOrigin: "50% 100%" }}
            initial={{ rotateX: -90, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ duration: 0.5, ease: EASE, delay: index * 0.08 }}
          >
            {digit}
          </motion.span>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setValue(1286)}
          className="rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary"
        >
          1,286
        </button>
        <button
          type="button"
          onClick={() => setValue(3942)}
          className="rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary"
        >
          3,942
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 卡片堆叠 */

/** 卡片堆叠：悬停时扇形展开，每张牌的旋转角递增——收起时是一摞，展开才可读 */
export function CardStack() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      data-lab="stack"
    >
      <div className="relative h-24 w-32">
        {[0, 1, 2].map((index) => (
          <motion.div
            key={index}
            className="absolute inset-0 flex items-center justify-center rounded-card border border-line-split bg-surface text-caption text-ink-secondary shadow-card"
            animate={
              reduce
                ? {}
                : {
                    rotate: open ? (index - 1) * 12 : 0,
                    x: open ? (index - 1) * 26 : 0,
                    y: open ? 0 : -index * 4,
                    zIndex: 3 - index,
                  }
            }
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
          >
            {["草稿", "已发布", "归档"][index]}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 时间轴 */

/** 时间轴：竖线自上而下"长"出来，节点在线到达时才弹出 */
export function TimelineDraw() {
  const nodes = [
    { time: "09:12", text: "创建会话" },
    { time: "09:13", text: "命中退款意图" },
    { time: "09:13", text: "检索 3 个片段" },
  ];
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="timeline">
      <div className="relative pl-5">
        <motion.span
          className="absolute left-1.5 top-1 w-0.5 bg-brand-300"
          initial={{ height: 0 }}
          animate={{ height: 66 }}
          transition={{ duration: reduce ? 0 : 0.7, ease: EASE }}
        />
        {nodes.map((node, index) => (
          <div key={node.time + node.text} className="relative mb-2.5 last:mb-0">
            <motion.span
              className="absolute -left-4 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 20, delay: reduce ? 0 : 0.2 + index * 0.22 }}
            />
            <div className="text-caption text-ink-primary">{node.text}</div>
            <div className="tabular text-[11px] text-ink-tertiary">{node.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 树展开 */

/** 树展开：高度从 0 长到 auto，子项错峰跟上——折叠时顺序反过来 */
export function TreeExpand() {
  const [open, setOpen] = useState(false);
  const children = ["意图路由", "知识检索", "工具调用"];
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="tree">
      <div className="w-40">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-caption text-ink-primary"
        >
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }} className="text-ink-tertiary">
            ▸
          </motion.span>
          主流程
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.ul
              className="ml-3.5 mt-1 space-y-1 border-l border-line-split pl-3"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
            >
              {children.map((child, index) => (
                <motion.li
                  key={child}
                  className="text-caption text-ink-secondary"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduce ? 0 : 0.24, delay: reduce ? 0 : index * 0.06 }}
                >
                  {child}
                </motion.li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
