/**
 * 反馈与状态组：点击波纹、加载形变、错误抖动、骨架交接。
 *
 * 这一组的共同点：它们都在回答用户的同一个问题——「我这一下，系统收到了吗？」
 * 所以判据不是「好看」，而是**因果必须落在动作发生的位置上**：
 * 波纹从按下点长出来、加载态从按钮本身长大、错误提示和出错字段一起抖。
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import { EASE } from "../../lib/motion";
import { LoadingRing, RippleLayer, ShakeBox, useRipple } from "../motion";

/* ---------------------------------------------------------------- 点击波纹 */

export function RippleDemo() {
  const { items, spawn } = useRipple();
  const [count, setCount] = useState(0);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5" data-lab="ripple">
      <button
        type="button"
        onPointerDown={spawn}
        onClick={() => setCount((n) => n + 1)}
        className="relative overflow-hidden rounded-control bg-brand-500 px-5 py-2 text-body text-white shadow-card transition-colors hover:bg-brand-600"
      >
        <span className="relative z-10">点击感受水膜</span>
        <RippleLayer items={items} />
      </button>

      <div className="text-center text-caption leading-5 text-ink-tertiary">
        <div className="tabular">{count > 0 ? `已点击 ${count} 次` : "波纹从按下点扩散，不是从中心"}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 加载形变 */

/**
 * 按钮加载形变：文字整体让位给「环 + 执行中」，按钮宽度跟着内容自然收放。
 *
 * 关键是**不要**把原文字用 opacity 藏起来再盖一层 spinner——
 * 那样按钮宽度不变，视觉上像「原地转圈」；用布局动画让宽度真的变了，
 * 用户才能感觉到「这个动作进入了一个有始有终的阶段」。
 */
export function LoadingMorphDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setPhase("done"), 1700);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const tone =
    phase === "done"
      ? "bg-[#68E1A6] hover:bg-[#237804]"
      : "bg-brand-500 hover:bg-brand-600";

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-5"
      data-lab="loading-morph"
    >
      <motion.button
        type="button"
        layout={!reduce}
        onClick={() => setPhase(phase === "loading" ? "idle" : "loading")}
        className={
          "relative flex items-center justify-center gap-2 overflow-hidden rounded-control px-4 py-2 text-body text-white shadow-card transition-colors " +
          tone
        }
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        whileTap={reduce ? undefined : { scale: 0.98 }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {phase === "loading" ? (
            <motion.span
              key="loading"
              className="flex items-center gap-2 whitespace-nowrap"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <LoadingRing size={14} thickness={2} />
              执行中
            </motion.span>
          ) : (
            <motion.span
              key={phase}
              className="flex items-center gap-2 whitespace-nowrap"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              {phase === "done" ? "已完成" : "开始执行"}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <p className="text-caption text-ink-tertiary">
        {phase === "loading" ? "运行中，再点一次可中断" : phase === "done" ? "1.7s 后自动完成" : "点一下看宽度怎么变"}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- 错误抖动 */

const FIELD_ERROR = "应用名称不能包含空格";

export function ShakeDemo() {
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="shake">
      {/* trigger 用 round 而不是 error 本身：连续触发同一条错误也能再抖一次 */}
      <ShakeBox trigger={round} className="w-[216px]">
        <div
          className={
            "rounded-control border bg-surface px-3 py-2 text-body transition-colors " +
            (error ? "border-[#FFA39E] text-[#FF9DA6]" : "border-line-base text-ink-secondary")
          }
        >
          {error ? "未命名 应用" : "输入一个应用名"}
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              key={error}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="mt-1.5 text-caption text-[#FF9DA6]"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </ShakeBox>

      <button
        type="button"
        onClick={() => {
          setError(error ? null : FIELD_ERROR);
          setRound((n) => n + 1);
        }}
        className="rounded-control border border-line-base bg-surface px-3 py-1.5 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        {error ? "清空重来" : "提交非法值"}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 骨架交接 */

const ROWS = [
  { title: "退款政策知识库", meta: "已索引 · 128 个片段" },
  { title: "售后话术库", meta: "已索引 · 64 个片段" },
  { title: "物流时效问答", meta: "索引中 · 32 / 48" },
];

/**
 * 骨架交接：扫光骨架 → 真实内容，用交叉淡入而不是直接替换。
 *
 * 注意骨架的宽度是「阶梯」而不是等宽：等宽骨架看起来像加载条，
 * 阶梯宽度更像真实文字的参差，等待时的心理感受会短一些。
 */
export function SkeletonSwap() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => setLoading((on) => !on), 2800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-5" data-lab="skeleton">
      {ROWS.map((row, index) => (
        <div
          key={row.title}
          className="relative flex h-[42px] items-center overflow-hidden rounded-control border border-line-split bg-surface px-3"
        >
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="skeleton"
                className="flex w-full flex-col gap-1.5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <span
                  className="sk-shimmer block h-2.5 rounded-sm"
                  style={{ width: `${58 - index * 6}%`, animationDelay: `${index * 0.12}s` }}
                />
                <span
                  className="sk-shimmer block h-2 rounded-sm"
                  style={{ width: `${38 - index * 4}%`, animationDelay: `${index * 0.12 + 0.08}s` }}
                />
              </motion.div>
            ) : (
              <motion.div
                key="content"
                className="flex w-full items-baseline justify-between"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.28, ease: EASE, delay: index * 0.05 }}
              >
                <span className="text-caption font-medium text-ink-primary">{row.title}</span>
                <span className="text-[11px] text-ink-tertiary">{row.meta}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
