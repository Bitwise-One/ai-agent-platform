/**
 * 编排组：多个元素按时间轴协同——动效的"导演层"。
 *
 * 这一组的核心不是单个动画，而是**节奏**：
 * 谁先动、等多久、用什么缓动。经验值：
 * - 同级元素错峰 40–80ms，少于 30ms 会糊成一片；
 * - 层级越深，延迟越大（标题 0ms、副标题 60ms、操作 120ms）；
 * - 退场必须比进场快，用户不会等你的离场动画。
 */

import { motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, useState } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 英雄堆叠 */

/** 英雄堆叠：标题 → 副标题 → 主操作，按视线落点依次进入 */
export function HeroStack() {
  const [round, setRound] = useState(0);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="hero">
      <div key={round} className="flex flex-col items-center gap-2">
        <motion.h3
          className="text-subtitle font-semibold text-ink-primary"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0.2 : 0.5, ease: EASE }}
        >
          一次配置，处处生效
        </motion.h3>
        <motion.p
          className="max-w-[200px] text-center text-caption text-ink-tertiary"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0.2 : 0.45, ease: EASE, delay: reduce ? 0 : 0.09 }}
        >
          模型、知识库与路由策略在应用级别共享
        </motion.p>
        <motion.button
          type="button"
          className="rounded-control bg-brand-500 px-3 py-1.5 text-caption text-white"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reduce ? 0.2 : 0.4, ease: EASE, delay: reduce ? 0 : 0.18 }}
          onClick={() => setRound((n) => n + 1)}
        >
          开始配置
        </motion.button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 交错网格 */

/** 交错网格：入场用 stagger， hover 用 spring——两种节奏不要混在一条 transition 里 */
export function StaggerGrid() {
  const [round, setRound] = useState(0);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="stagger">
      <div key={round} className="grid grid-cols-4 gap-2">
        {Array.from({ length: 12 }, (_, i) => (
          <motion.span
            key={i}
            className="h-5 w-5 rounded-sm bg-brand-300"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: reduce ? 0.2 : 0.42, ease: EASE, delay: reduce ? 0 : i * 0.04 }}
            whileHover={reduce ? undefined : { scale: 1.25, backgroundColor: "#0D7665" }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRound((n) => n + 1)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        重播
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 时间轴擦洗 */

/** 时间轴擦洗：拖动滑块直接驱动一段编排的进度，用来"逐帧"检查动效 */
export function TimelineScrub() {
  const reduce = useReducedMotion();
  const progress = useMotionValue(0);
  const dotY = useTransform(progress, (v) => 4 + v * 40);
  const dotX = useTransform(progress, (v) => 4 + v * 132);
  const label = useTransform(progress, (v) => `${Math.round(v * 100)}%`);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="scrubber">
      <div className="relative h-12 w-36">
        <span className="absolute left-0 top-0 h-12 w-0.5 bg-line-base" />
        <motion.span
          className="absolute left-0 top-0 h-12 w-0.5 bg-brand-500"
          style={{ scaleY: progress, originY: 0 }}
        />
        <motion.span
          className="absolute h-2.5 w-2.5 rounded-full bg-brand-600"
          style={{ x: dotX, y: dotY, marginLeft: -5, marginTop: -5 }}
        />
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          aria-label="编排进度"
          onChange={(event) => progress.set(Number(event.target.value))}
          className="w-32 accent-brand-500"
          disabled={Boolean(reduce)}
        />
        <motion.span className="tabular w-10 text-caption text-ink-tertiary">{label}</motion.span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 幕布 */

/** 幕布：两半向两边拉开，后面的内容先暗后亮——顺序即"揭晓" */
export function CurtainWipe() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div
      className="relative h-full w-full cursor-pointer overflow-hidden"
      onClick={() => setOpen((v) => !v)}
      data-lab="curtain"
    >
      <motion.div
        className="absolute inset-0 flex items-center justify-center bg-brand-50 text-caption text-brand-600"
        animate={{ opacity: open ? 1 : 0.45 }}
        transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : open ? 0.2 : 0 }}
      >
        幕布之后
      </motion.div>

      {[0, 1].map((half) => (
        <motion.div
          key={half}
          className="absolute top-0 h-full w-1/2 bg-brand-500"
          style={{ left: half === 0 ? 0 : "50%" }}
          animate={reduce ? { x: 0 } : { x: open ? (half === 0 ? "-100%" : "100%") : 0 }}
          transition={{ duration: reduce ? 0 : 0.55, ease: EASE }}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- 形态过渡 */

/** 形态过渡：按钮长成卡片，layout 负责补间，内容用 AnimatePresence 交接 */
export function MorphButton() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="morphbtn">
      <motion.button
        layout={!reduce}
        onClick={() => setOpen((v) => !v)}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={
          "overflow-hidden rounded-card border border-line-split bg-surface text-left " +
          (open ? "h-24 w-44 px-3 py-2.5" : "flex h-9 items-center justify-center px-4")
        }
      >
        {open ? (
          <motion.span
            key="body"
            className="block"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : 0.12 }}
          >
            <span className="block text-caption font-medium text-ink-primary">路由配置</span>
            <span className="mt-1 block text-[11px] leading-5 text-ink-tertiary">
              关键词 + 置信度阈值，命中后交给对应 Agent。
            </span>
          </motion.span>
        ) : (
          <span className="text-caption text-ink-primary">点我展开</span>
        )}
      </motion.button>
    </div>
  );
}

/* ---------------------------------------------------------------- 共享元素 */

/** 共享元素：缩略图与大图共用 layoutId，浏览器自动补间中间帧 */
export function SharedElement() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="shared">
      {open ? (
        <motion.div
          layoutId="shared-card"
          onClick={() => setOpen(false)}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="flex h-28 w-40 cursor-zoom-out items-center justify-center rounded-card bg-brand-500 text-caption text-white"
        >
          点击收起
        </motion.div>
      ) : (
        <motion.div
          layoutId="shared-card"
          onClick={() => setOpen(true)}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="flex h-10 w-14 cursor-zoom-in items-center justify-center rounded-control bg-brand-300 text-[11px] text-white"
        >
          缩略图
        </motion.div>
      )}
      {!open && !reduce && (
        <span className="ml-3 text-[11px] text-ink-tertiary">同一元素，两种尺寸</span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 彩带 */

/** 彩带：每片有自己的横向漂移与旋转，落点随机才不会像同一条传送带 */
export function ConfettiRain() {
  const [run, setRun] = useState(0);
  const pieces = Array.from({ length: 16 }, (_, i) => ({
    left: `${4 + i * 6}%`,
    delay: (i % 5) * 0.12,
    duration: 1.4 + (i % 4) * 0.25,
    color: ["#0D7665", "#39B69A", "#8EE3AE", "#FFD591", "#FF7875"][i % 5],
    size: 4 + (i % 3) * 2,
  }));

  return (
    <div className="flex h-full w-full flex-col items-center justify-center" data-lab="confetti">
      <div key={run} className="relative h-24 w-full overflow-hidden">
        {pieces.map((piece, index) => (
          <span
            key={index}
            className="anim-confetti absolute top-2 rounded-sm"
            style={{
              left: piece.left,
              width: piece.size,
              height: piece.size * 1.6,
              background: piece.color,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
            }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRun((n) => n + 1)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        再撒一次
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 擦除转场 */

/** 擦除转场：新内容被一道竖线"擦"出来，比淡入更有"翻篇"的意思 */
export function WipeTransition() {
  const [page, setPage] = useState(0);
  const reduce = useReducedMotion();
  const labels = ["发布记录", "版本对比", "回滚"];

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="wipe">
      <div className="relative h-14 w-40 overflow-hidden rounded-control border border-line-split bg-surface">
        {labels.map((label, index) => (
          <motion.div
            key={label}
            className="absolute inset-0 flex items-center justify-center text-caption text-ink-primary"
            initial={reduce ? { opacity: 0 } : { clipPath: "inset(0 100% 0 0)", opacity: 0 }}
            animate={
              index === page
                ? reduce
                  ? { opacity: 1 }
                  : { clipPath: "inset(0 0% 0 0)", opacity: 1 }
                : { opacity: 0 }
            }
            transition={{ duration: reduce ? 0 : 0.45, ease: EASE }}
          >
            {label}
          </motion.div>
        ))}
      </div>
      <div className="flex gap-2">
        {labels.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setPage(index)}
            className={
              "rounded-control px-2.5 py-1 text-caption transition-colors " +
              (page === index
                ? "border border-brand-400 bg-brand-50 text-brand-600"
                : "border border-line-base bg-surface text-ink-secondary")
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 聚光舞台 */

/** 聚光舞台：一盏灯在台上左右扫，照到哪个区块哪个区块才亮 */
export function SpotlightStage() {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const glow = useTransform(x, (v) => `radial-gradient(circle 44px at ${v + 90}px 60px, rgba(105,217,179,0.28), transparent 70%)`);

  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 1;
      x.set(90 + Math.sin(frame / 46) * 62);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce, x]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#14211C]" onPointerMove={(event) => {
      if (reduce) return;
      const rect = event.currentTarget.getBoundingClientRect();
      x.set(event.clientX - rect.left - 90);
    }} data-lab="stage">
      <motion.div className="absolute inset-0" style={{ background: glow }} />
      <div className="relative flex h-full items-center justify-around px-4">
        {["路由", "检索", "生成"].map((item) => (
          <span
            key={item}
            className="rounded-control border border-white/15 px-2.5 py-1.5 text-caption text-white/70"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 收尾序列 */

/** 收尾序列：四步依次打勾，最后落一个完成态——把"过程"演给用户看 */
export function OutroSequence() {
  const [step, setStep] = useState(-1);
  const reduce = useReducedMotion();
  const steps = ["保存草稿", "生成版本", "绑定应用", "发布上线"];

  useEffect(() => {
    if (step >= steps.length) return;
    const timer = window.setTimeout(() => setStep((s) => s + 1), reduce ? 80 : 420);
    return () => window.clearTimeout(timer);
  }, [reduce, step, steps.length]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="outro">
      <ul className="space-y-2">
        {steps.map((label, index) => (
          <motion.li
            key={label}
            className="flex items-center gap-2 text-caption"
            animate={{ opacity: index <= step ? 1 : 0.35 }}
            transition={{ duration: 0.3 }}
          >
            <motion.span
              className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white"
              style={{ background: index <= step ? "#68E1A6" : "#52645D" }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 22, delay: reduce ? 0 : index * 0.42 }}
            >
              ✓
            </motion.span>
            <span className={index <= step ? "text-ink-primary" : "text-ink-tertiary"}>{label}</span>
          </motion.li>
        ))}
      </ul>
      <motion.span
        className="text-caption font-medium text-[#68E1A6]"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: step >= steps.length ? 1 : 0, scale: step >= steps.length ? 1 : 0.8 }}
        transition={{ type: "spring", stiffness: 420, damping: 18, delay: reduce ? 0 : 0.2 }}
      >
        全部完成
      </motion.span>
    </div>
  );
}
