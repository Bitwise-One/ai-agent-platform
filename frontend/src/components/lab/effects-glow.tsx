/**
 * 光影组：视角、光源、辉光——让平面产生厚度。
 *
 * 这一组一半靠「光跟人走」（聚光、光晕、视差），一半靠「光自己活着」
 * （射线、霓虹、渐变标题）。跟随光必须用 JS（要读坐标），自己活着的一律 CSS。
 */

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 聚光灯 */

/**
 * 聚光灯：一层跟着光标的 radial 遮罩，把周围压暗。
 * 深色面板 + 高亮字，比浅色更能表现「一束光打下来」。
 */
export function Spotlight() {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const mask = useTransform(
    [x, y],
    ([mx, my]: number[]) =>
      `radial-gradient(circle 64px at ${mx}px ${my}px, transparent 0%, rgba(255,255,255,0.96) 72%)`,
  );

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1D1B26]" onPointerMove={onMove} data-lab="spotlight">
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center"
        style={{ maskImage: reduce ? undefined : mask, WebkitMaskImage: reduce ? undefined : mask }}
      >
        <span className="text-body font-medium text-white">路由到「售后助手」</span>
        <span className="text-caption text-brand-200">置信度 0.87 · 关键词命中</span>
      </motion.div>
      <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-white/45">
        移动光标照亮
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- 多层视差 */

/** 多层视差：三层按 0.2 / 0.5 / 1.0 的系数跟随光标，才有纵深感 */
export function ParallaxLayers() {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const far = useSpring(useTransform(px, (v) => v * 0.2), { stiffness: 120, damping: 20 });
  const farY = useSpring(useTransform(py, (v) => v * 0.2), { stiffness: 120, damping: 20 });
  const mid = useSpring(useTransform(px, (v) => v * 0.5), { stiffness: 120, damping: 20 });
  const midY = useSpring(useTransform(py, (v) => v * 0.5), { stiffness: 120, damping: 20 });

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left - rect.width / 2) / 8);
    py.set((event.clientY - rect.top - rect.height / 2) / 8);
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[linear-gradient(160deg,#F6F1FB,#EBE0F7)]"
      onPointerMove={onMove}
      data-lab="parallax"
    >
      <motion.span
        className="absolute left-6 top-8 h-12 w-12 rounded-full bg-brand-200/70"
        style={{ x: far, y: farY }}
      />
      <motion.span
        className="absolute right-8 top-16 h-8 w-8 rounded-md bg-brand-400/60"
        style={{ x: mid, y: midY }}
      />
      <motion.span
        className="absolute bottom-10 left-1/2 rounded-card border border-brand-300 bg-white/80 px-3 py-2 text-caption text-brand-600 shadow-card"
        style={{ x: px, y: py, translateX: "-50%" }}
      >
        三层不同速度
      </motion.span>
    </div>
  );
}

/* ---------------------------------------------------------------- 全息箔 */

/** 全息箔：hue-rotate 跟随光标与中心的夹角，彩虹只在斜看时才出现 */
export function HoloFoil() {
  const reduce = useReducedMotion();
  const [angle, setAngle] = useState(120);
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    setAngle((Math.atan2(dy, dx) * 180) / Math.PI);
  };

  return (
    <div
      ref={ref}
      className="flex h-full w-full items-center justify-center"
      onPointerMove={onMove}
      data-lab="holo"
    >
      <div
        className="flex h-20 w-32 items-center justify-center rounded-card border border-white/60 shadow-card"
        style={{
          background:
            "linear-gradient(115deg, rgba(118,68,167,0.85), rgba(94,124,224,0.7) 35%, rgba(56,158,13,0.6) 60%, rgba(217,119,6,0.65) 85%)",
          filter: `hue-rotate(${angle.toFixed(1)}deg) saturate(1.2)`,
          transition: "filter 90ms linear",
        }}
      >
        <span className="text-caption font-medium text-white drop-shadow">全息箔</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 文字扫光 */

/** 文字扫光：background-clip:text + 一条斜向高光，比 box-shadow 更干净 */
export function TextShine() {
  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="shine">
      <span className="anim-shine text-subtitle font-semibold" style={{ color: "#7644A7", animationDuration: "4.2s" }}>
        扫过一道光
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 渐变标题 */

/** 渐变标题：色带在文字里循环流动，只给标题级文字用，正文会读不清 */
export function GradientTitle() {
  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="gradient">
      <span className="anim-gradient-text text-title font-semibold">多智能体编排</span>
    </div>
  );
}

/* ---------------------------------------------------------------- 阴影抬升 */

/** 阴影抬升：hover 时位移 4px、阴影同时变深变远——距离感来自阴影而不是位移本身 */
export function ShadowLift() {
  const reduce = useReducedMotion();
  const [up, setUp] = useState(false);

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onPointerEnter={() => setUp(true)}
      onPointerLeave={() => setUp(false)}
      data-lab="lift"
    >
      <motion.div
        className="flex h-20 w-36 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border border-line-split bg-surface"
        animate={reduce ? {} : { y: up ? -4 : 0 }}
        transition={{ duration: 0.28, ease: EASE }}
        style={{
          boxShadow: up
            ? "0 10px 24px -6px rgba(78,44,111,0.22), 0 2px 6px -2px rgba(78,44,111,0.12)"
            : "0 1px 2px 0 rgba(0,0,0,0.04)",
          transitionProperty: "box-shadow",
        }}
      >
        <span className="text-caption font-medium text-ink-primary">悬停抬升</span>
        <span className="text-[11px] text-ink-tertiary">y -4px + 阴影变深</span>
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- 光芒射线 */

/** 光芒射线：conic-gradient 的硬边条纹慢慢旋转，像光源在扫过棱镜 */
export function RayBurst() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#1D1B26]" data-lab="rays">
      <span
        className="anim-spin-slow absolute h-56 w-56 rounded-full opacity-45"
        style={{
          background:
            "conic-gradient(from 0deg, rgba(185,149,220,0.9) 0deg 6deg, transparent 6deg 22deg, rgba(156,107,201,0.7) 22deg 28deg, transparent 28deg 46deg)",
          maskImage: "radial-gradient(circle, transparent 18%, #000 60%)",
          WebkitMaskImage: "radial-gradient(circle, transparent 18%, #000 60%)",
          animationDuration: "24s",
        }}
      />
      <span className="relative h-10 w-10 rounded-full bg-white shadow-[0_0_28px_10px_rgba(185,149,220,0.55)]" />
    </div>
  );
}

/* ---------------------------------------------------------------- 棱镜散射 */

/** 棱镜散射：一束白光进去，三束彩光依次偏折出来——错峰 60ms 是"折射有时间差" */
export function PrismSplit() {
  const reduce = useReducedMotion();
  const [on, setOn] = useState(false);

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onPointerEnter={() => setOn(true)}
      onPointerLeave={() => setOn(false)}
      data-lab="prism"
    >
      <div className="relative h-24 w-40">
        <span className="absolute left-0 top-1/2 h-1.5 w-10 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_3px_rgba(255,255,255,0.8)]" />
        <span className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white/40 bg-white/10" />

        {[
          { color: "#FF7875", angle: -26, delay: 0 },
          { color: "#FFD591", angle: 0, delay: 0.06 },
          { color: "#95DE64", angle: 26, delay: 0.12 },
        ].map((beam) => (
          <motion.span
            key={beam.color}
            className="absolute left-1/2 top-1/2 h-1.5 w-24 origin-left rounded-full"
            style={{ background: beam.color, rotate: `${beam.angle}deg` }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: on && !reduce ? 1 : 0, opacity: on && !reduce ? 0.95 : 0 }}
            transition={{ duration: reduce ? 0 : 0.34, ease: EASE, delay: reduce ? 0 : beam.delay }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 镜头光晕 */

/** 镜头光晕：主光斑 + 一颗鬼影，全部跟着光标但系数不同，才像镜头里的折射 */
export function LensFlare() {
  const reduce = useReducedMotion();
  const x = useMotionValue(150);
  const y = useMotionValue(90);
  const ghostX = useSpring(useTransform(x, (v) => 300 - v), { stiffness: 90, damping: 18 });
  const ghostY = useSpring(useTransform(y, (v) => 180 - v), { stiffness: 90, damping: 18 });

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#221E2C]" onPointerMove={onMove} data-lab="flare">
      <motion.span
        className="pointer-events-none absolute h-2 w-24 rounded-full bg-white/80 blur-[3px]"
        style={{ x, y, marginLeft: -48, marginTop: -4 }}
      />
      <motion.span
        className="pointer-events-none absolute h-10 w-10 rounded-full bg-brand-300/70 blur-md"
        style={{ x, y, marginLeft: -20, marginTop: -20 }}
      />
      <motion.span
        className="pointer-events-none absolute h-4 w-4 rounded-full bg-[#FFD591]/70 blur-[2px]"
        style={{ x: ghostX, y: ghostY, marginLeft: -8, marginTop: -8 }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- 霓虹闪烁 */

/** 霓虹闪烁：灯管刚通电那几下不稳，之后才稳定——用 steps 卡掉插值 */
export function NeonFlicker() {
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#1D1B26]" data-lab="neon">
      <span
        className="text-subtitle font-semibold tracking-widest text-brand-200"
        style={
          reduce
            ? { textShadow: "0 0 12px rgba(185,149,220,0.7)" }
            : {
                textShadow:
                  "0 0 8px rgba(185,149,220,0.9), 0 0 22px rgba(118,68,167,0.65), 0 0 44px rgba(118,68,167,0.35)",
                animation: "lab-flicker 3.6s steps(1,end) infinite",
              }
        }
      >
        营业中
      </span>
    </div>
  );
}
