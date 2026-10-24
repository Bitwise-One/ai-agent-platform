/**
 * 材质组：让界面看起来是「物质」做的，而不是平面。
 *
 * 这一组的共同点：都在模拟一种物理材质（液体、玻璃、金属、墨水）。
 * 实现上分两条路——
 * - 形变/循环交给 CSS（合成线程，主线程再忙也不掉帧）；
 * - 跟随指针的（拖尾、黏稠）必须 JS，因为每一帧都要读坐标。
 */

import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 液体拖尾 */

const TRAIL = [
  { stiffness: 620, damping: 26, size: 12, opacity: 0.85 },
  { stiffness: 460, damping: 26, size: 16, opacity: 0.5 },
  { stiffness: 340, damping: 24, size: 20, opacity: 0.32 },
  { stiffness: 250, damping: 22, size: 24, opacity: 0.2 },
  { stiffness: 170, damping: 20, size: 28, opacity: 0.12 },
];

/**
 * 液体拖尾：五颗同一位置、不同刚度的小球。
 *
 * 关键点是「刚度递减」而不是「延迟递增」：延迟会让尾巴在快速移动时断成一节一节，
 * 刚度递减则像真的有一串液体被拽着走，停下来时它们会先后归位。
 */
export function LiquidTrail() {
  const reduce = useReducedMotion();
  const x = useMotionValue(150);
  const y = useMotionValue(90);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  };

  return (
    <div
      className="relative h-full w-full cursor-crosshair overflow-hidden"
      onPointerMove={move}
      data-lab="trail"
    >
      {reduce ? (
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500" />
      ) : (
        TRAIL.map((bead, index) => (
          <TrailBead key={index} x={x} y={y} bead={bead} />
        ))
      )}
      <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-ink-tertiary">
        移动光标
      </p>
    </div>
  );
}

function TrailBead({
  x,
  y,
  bead,
}: {
  x: ReturnType<typeof useMotionValue<number>>;
  y: ReturnType<typeof useMotionValue<number>>;
  bead: { stiffness: number; damping: number; size: number; opacity: number };
}) {
  const sx = useSpring(x, { stiffness: bead.stiffness, damping: bead.damping, mass: 0.6 });
  const sy = useSpring(y, { stiffness: bead.stiffness, damping: bead.damping, mass: 0.6 });

  return (
    <motion.span
      className="pointer-events-none absolute rounded-full bg-brand-500"
      style={{
        width: bead.size,
        height: bead.size,
        left: 0,
        top: 0,
        x: sx,
        y: sy,
        marginLeft: -bead.size / 2,
        marginTop: -bead.size / 2,
        opacity: bead.opacity,
      }}
    />
  );
}

/* ---------------------------------------------------------------- 涟漪池 */

interface PondRing {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
}

/** 水波涟漪池：点哪里，哪里长出一圈圈扩散的水纹 */
export function RipplePond() {
  const [rings, setRings] = useState<PondRing[]>([]);
  // 用 ref 而不是 state 计数：这里只需要一个自增 id，不需要触发重渲染
  const seed = useRef(0);

  return (
    <div
      className="relative h-full w-full cursor-pointer overflow-hidden"
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const next = ++seed.current;
        setRings((prev) => [
          ...prev.slice(-8),
          { id: next, x, y, size: 20 + (next % 3) * 10, delay: 0 },
          { id: next * 1000 + 1, x, y, size: 14, delay: 0.12 },
          { id: next * 1000 + 2, x, y, size: 8, delay: 0.24 },
        ]);
      }}
      data-lab="pond"
    >
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(118,68,167,0.05),rgba(94,124,224,0.05))]" />
      {rings.map((ring) => (
        <motion.span
          key={ring.id}
          className="pointer-events-none absolute rounded-full border border-brand-400"
          style={{ left: ring.x - ring.size / 2, top: ring.y - ring.size / 2, width: ring.size, height: ring.size }}
          initial={{ scale: 0.4, opacity: 0.7 }}
          animate={{ scale: 5.2, opacity: 0 }}
          transition={{ duration: 1.4, ease: EASE, delay: ring.delay }}
        />
      ))}
      <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-ink-tertiary">
        点击水面
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- 熔岩灯 */

/** 熔岩灯：三团不规则圆角的光，用不同周期上升/下落，互不同步才像在翻涌 */
export function LavaLamp() {
  const blobs = [
    { size: 46, x: "18%", dur: 7.5, delay: 0, color: "rgba(118,68,167,0.55)" },
    { size: 32, x: "46%", dur: 9.2, delay: -3, color: "rgba(156,107,201,0.5)" },
    { size: 38, x: "70%", dur: 8.1, delay: -5.5, color: "rgba(94,124,224,0.45)" },
  ];

  return (
    <div className="relative h-full w-full overflow-hidden" data-lab="lava">
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(to_top,rgba(118,68,167,0.12),transparent)]" />
      {blobs.map((blob, index) => (
        <span
          key={index}
          // 两条动画分工：lab-blob 负责形变（表面张力），lab-lava-rise 负责上升（对流）。
          // 后者走 translate 属性而不是 transform，否则两条动画会互相覆盖。
          className="anim-blob anim-lava absolute bottom-4"
          style={{
            width: blob.size,
            height: blob.size,
            left: blob.x,
            background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.5), ${blob.color})`,
            animationDuration: `${blob.dur}s, ${blob.dur}s`,
            animationDelay: `${blob.delay}s, ${blob.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- 水银珠 */

/** 水银珠：高光 + 反射构成的金属球，hover 时压扁一点再弹回（表面张力） */
export function MercuryDrop() {
  const reduce = useReducedMotion();
  const [squash, setSquash] = useState(false);

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="mercury">
      <motion.div
        className="relative h-14 w-14 cursor-pointer"
        onPointerEnter={() => setSquash(true)}
        onPointerLeave={() => setSquash(false)}
        animate={reduce ? {} : { scaleX: squash ? 1.22 : 1, scaleY: squash ? 0.82 : 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 12, mass: 0.7 }}
      >
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,#ffffff,rgba(255,255,255,0)_42%),radial-gradient(circle_at_65%_72%,#B995DC,#7644A7_58%,#4E2C6F)]" />
        <span className="absolute left-[26%] top-[18%] h-3 w-4 -rotate-12 rounded-full bg-white/85 blur-[2px]" />
        <span className="absolute bottom-1 left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-full bg-brand-700/25 blur-[3px]" />
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- 玻璃拟态 */

/**
 * 玻璃拟态：拟物在「背后有东西在动」时才成立。
 * 这里背后放一团极光，前景卡片用 backdrop-blur 吃掉细节，再叠一道横扫的高光。
 */
export function GlassPanel() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden" data-lab="glass">
      <span className="anim-drift absolute h-32 w-32 rounded-full bg-brand-300/70" style={{ animationDuration: "14s" }} />
      <span
        className="anim-drift absolute h-24 w-24 rounded-full bg-[#5E7CE0]/60"
        style={{ animationDuration: "18s", animationDelay: "-6s", left: "55%", top: "18%" }}
      />

      <div className="relative w-[150px] overflow-hidden rounded-card border border-white/60 bg-white/35 px-4 py-3 backdrop-blur-md">
        <div className="text-caption font-medium text-ink-primary">毛玻璃卡片</div>
        <div className="mt-0.5 text-[11px] text-ink-secondary">背景在动，玻璃才有意义</div>
        <span
          className="anim-shine pointer-events-none absolute inset-0"
          style={{ color: "rgba(255,255,255,0.85)", animationDuration: "4.5s" }}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 磨砂融化 */

/** 磨砂融化：hover 时模糊半径与不透明度同步回落，像冰面化开 */
export function FrostMelt() {
  const [hot, setHot] = useState(false);

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      data-lab="frost"
    >
      <motion.div
        className="flex h-16 w-32 cursor-pointer flex-col items-center justify-center rounded-card border border-brand-200 bg-brand-50"
        animate={{ filter: hot ? "blur(0px)" : "blur(3px)", opacity: hot ? 1 : 0.72 }}
        transition={{ duration: 0.45, ease: EASE }}
      >
        <span className="text-caption font-medium text-brand-600">悬停我</span>
        <span className="text-[11px] text-ink-tertiary">模糊 3px → 0</span>
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- 墨水扩散 */

/**
 * 墨水扩散：feTurbulence 生成噪波，feDisplacementMap 让边缘毛糙。
 * 关键是 scale 涨得慢、opacity 掉得快——墨会散开，但颜色很快就淡了。
 */
export function InkBloom() {
  const [round, setRound] = useState(0);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="ink">
      <svg width="180" height="120" viewBox="0 0 180 120">
        <defs>
          <filter id="lab-ink">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={2} seed={round} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <motion.circle
          key={round}
          cx="90"
          cy="60"
          r="34"
          fill="#7644A7"
          filter="url(#lab-ink)"
          initial={{ scale: 0.2, opacity: 0.9 }}
          animate={{ scale: 1, opacity: 0.35 }}
          transition={{ duration: 1.5, ease: EASE }}
        />
      </svg>
      <button
        type="button"
        onClick={() => setRound((n) => n + 1)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        再滴一滴
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 黏稠回弹 */

/** 黏稠回弹：拖出去越远，橡皮筋拉力越大；松手后过冲一下再回位 */
export function ViscousBlob() {
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="viscous">
      <motion.div
        className="flex h-14 w-14 cursor-grab items-center justify-center rounded-full bg-brand-500 text-[10px] text-white active:cursor-grabbing"
        drag={!reduce}
        dragSnapToOrigin
        dragElastic={0.16}
        dragTransition={{ bounceStiffness: 260, bounceDamping: 18 }}
        whileDrag={{ scale: 1.1 }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 18 }}
      >
        拖我
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- 气泡上升 */

const BUBBLES = Array.from({ length: 9 }, (_, i) => ({
  size: 6 + (i % 4) * 4,
  left: `${6 + i * 10.5}%`,
  dur: 3.6 + (i % 3) * 1.1,
  delay: -i * 0.42,
}));

/** 气泡上升：translateY 负责上升，左右摆动用第二个 span 叠加，互不干扰 */
export function BubbleRise() {
  return (
    <div className="relative h-full w-full overflow-hidden" data-lab="bubbles">
      {BUBBLES.map((bubble, index) => (
        <span
          key={index}
          className="anim-rain absolute bottom-0"
          style={{
            width: bubble.size,
            height: bubble.size,
            left: bubble.left,
            animationDuration: `${bubble.dur}s`,
            animationDelay: `${bubble.delay}s`,
          }}
        >
          <span className="block h-full w-full rounded-full border border-brand-300 bg-brand-100/60" />
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- 张力滴落 */

/**
 * 表面张力滴落：先被「拉长」成水滴形，再断开下落。
 *
 * 常驻循环交给 CSS：framermotion 的 repeat:Infinity 在开发模式（StrictMode）下
 * 会被动过生命周期，最终停在终态不动，所以一切「永远在动」的都写 keyframes。
 */
export function TensionDrop() {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden" data-lab="tension">
      <div className="relative h-20 w-12">
        <span
          className="anim-tension absolute left-1/2 top-0 h-8 w-8 -translate-x-1/2 rounded-full bg-brand-500"
          style={{ transformOrigin: "50% 0" }}
        />
        <span className="absolute bottom-0 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-brand-500/30 blur-[3px]" />
      </div>
    </div>
  );
}
