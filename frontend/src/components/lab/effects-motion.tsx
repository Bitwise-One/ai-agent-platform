/**
 * 运动组：弹簧、阻尼、惯性、抛射——所有「手感」都来自参数而不是关键帧。
 *
 * 这一组几乎都要读指针位置，所以必须是 JS 驱动；但释放之后的余动
 * （弹跳、摆动、旋转）一律交给 CSS，避免主线程每帧都参与。
 */

import { motion, useAnimationControls, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useState } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 弹簧链 */

const CHAIN = [
  { stiffness: 700, damping: 30 },
  { stiffness: 520, damping: 28 },
  { stiffness: 380, damping: 26 },
  { stiffness: 260, damping: 24 },
  { stiffness: 160, damping: 22 },
];

/**
 * 弹簧链：五个球用递减刚度串在光标后面，球之间画连线。
 *
 * 递减刚度 = 整条链被"带"着走；如果每颗球刚度相同，看起来就只是五颗球同时动。
 * 每颗球的 spring 通过 usePair（自定义 hook）创建——hooks 不能写在 map 里，
 * 哪怕数组长度恒定也不行，将来改长度就是一次线上事故。
 */
export function SpringChain() {
  const reduce = useReducedMotion();
  const x = useMotionValue(110);
  const y = useMotionValue(60);

  const p1 = usePair(x, y, CHAIN[0]);
  const p2 = usePair(x, y, CHAIN[1]);
  const p3 = usePair(x, y, CHAIN[2]);
  const p4 = usePair(x, y, CHAIN[3]);
  const p5 = usePair(x, y, CHAIN[4]);
  const points = [p1, p2, p3, p4, p5];

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  };

  return (
    <div className="relative h-full w-full overflow-hidden" onPointerMove={onMove} data-lab="chain">
      {reduce ? (
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500" />
      ) : (
        <>
          <ChainLines points={points} />
          {points.map((point, index) => (
            <motion.span
              key={index}
              className="pointer-events-none absolute rounded-full"
              style={{
                width: 16 - index,
                height: 16 - index,
                marginLeft: -(16 - index) / 2,
                marginTop: -(16 - index) / 2,
                x: point.x,
                y: point.y,
                background: index === 0 ? "#7644A7" : `rgba(118,68,167,${0.85 - index * 0.16})`,
              }}
            />
          ))}
        </>
      )}
      <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-ink-tertiary">
        甩动光标
      </p>
    </div>
  );
}

/** 一对弹簧：x / y 各一根，参数一致才走得直 */
function usePair(x: ReturnType<typeof useMotionValue<number>>, y: ReturnType<typeof useMotionValue<number>>, cfg: { stiffness: number; damping: number }) {
  const sx = useSpring(x, { stiffness: cfg.stiffness, damping: cfg.damping, mass: 0.6 });
  const sy = useSpring(y, { stiffness: cfg.stiffness, damping: cfg.damping, mass: 0.6 });
  return { x: sx, y: sy };
}

type Point = { x: ReturnType<typeof useSpring>; y: ReturnType<typeof useSpring> };

function ChainLines({ points }: { points: Point[] }) {
  const d = useTransform(
    points.flatMap((point) => [point.x, point.y]),
    (values: number[]) =>
      values.reduce<string>(
        (acc, value, index) =>
          acc + (index % 2 === 0 ? `${index === 0 ? "M" : "L"}${Math.round(value)} ` : `${Math.round(value)} `),
        "",
      ),
  );

  return (
    <motion.svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <motion.path d={d} fill="none" stroke="rgba(118,68,167,0.35)" strokeWidth={1.5} strokeDasharray="4 3" />
    </motion.svg>
  );
}

/* ---------------------------------------------------------------- 摆锤 */

/** 单摆：整段交给 CSS（transform-origin 在顶端），用 sin 的近似的非线性关键帧 */
export function PendulumSwing() {
  return (
    <div className="relative h-full w-full overflow-hidden" data-lab="pendulum">
      <span className="absolute left-1/2 top-3 h-1 w-1 -translate-x-1/2 rounded-full bg-ink-tertiary" />
      <span
        className="anim-pendulum absolute left-1/2 top-3 origin-top"
        style={{ height: 92, width: 1, background: "rgba(118,68,167,0.35)" }}
      >
        <span className="absolute -bottom-2 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full bg-brand-500 shadow-card" />
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 自由落体 */

/**
 * 自由落体：下落加速 + 触地压扁 + 回弹，三段用 await 串起来。
 *
 * 压扁是这套动作可信度的全部来源：没有压扁的落地像一张纸，有压扁才有质量。
 */
export function FreeFall() {
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  const [count, setCount] = useState(0);

  const drop = async () => {
    if (reduce) return;
    setCount((n) => n + 1);
    await controls.start({ y: 92, transition: { duration: 0.42, ease: [0.4, 0, 1, 1] } });
    await controls.start({ scaleY: 0.55, scaleX: 1.35, transition: { duration: 0.09 } });
    await controls.start({ scaleY: 1, scaleX: 1, y: 78, transition: { duration: 0.3, ease: "easeOut" } });
    await controls.start({ y: 92, scaleY: 0.7, scaleX: 1.2, transition: { duration: 0.16, ease: "easeIn" } });
    await controls.start({ scaleY: 1, scaleX: 1, y: 92, transition: { duration: 0.2 } });
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="fall">
      <div className="relative h-24 w-20">
        <motion.div
          className="h-7 w-7 rounded-full bg-brand-500 shadow-card"
          animate={controls}
          initial={{ y: 0 }}
          style={{ originY: 1 }}
        />
        <span className="absolute bottom-0 left-1/2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-brand-500/25 blur-[3px]" />
      </div>
      <button
        type="button"
        onClick={() => void drop()}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        松手（已落 {count} 次）
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 惯性抛掷 */

/** 惯性抛掷：拖动松手后按甩出速度继续飞，被边界挡回来（bounceStiffness 越低越弹） */
export function InertiaToss() {
  const reduce = useReducedMotion();
  const [speed, setSpeed] = useState("—");

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="inertia">
      <motion.div
        className="flex h-12 w-12 cursor-grab items-center justify-center rounded-card bg-brand-500 text-[10px] text-white active:cursor-grabbing"
        drag={!reduce}
        dragConstraints={{ left: -70, right: 70, top: -40, bottom: 40 }}
        dragElastic={0.9}
        dragMomentum
        dragTransition={{ bounceStiffness: 180, bounceDamping: 14 }}
        whileDrag={{ scale: 1.08 }}
        onDragEnd={(_, info) => setSpeed(`${Math.round(Math.hypot(info.velocity.x, info.velocity.y))}`)}
      >
        甩我
      </motion.div>
      <span className="tabular text-caption text-ink-tertiary">松手速度 {speed} px/s</span>
    </div>
  );
}

/* ---------------------------------------------------------------- 橡皮筋 */

/**
 * 橡皮筋：越往边界外拉，阻力越大。
 * 用 dragElastic 做物理，另外把拖动量映射成 scaleX——视觉上也要"被拽住"。
 */
export function RubberBand() {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const scaleX = useTransform(x, [-90, 0, 90], [1.5, 1, 1.5]);

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="rubber">
      <motion.div
        className="h-12 w-24 cursor-ew-resize rounded-card bg-brand-500"
        style={{ x, scaleX: reduce ? 1 : scaleX }}
        drag={reduce ? false : "x"}
        dragConstraints={{ left: -60, right: 60 }}
        dragElastic={0.12}
        dragTransition={{ bounceStiffness: 420, bounceDamping: 30 }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- 降落伞 */

/** 降落伞：同样的拖拽，把阻尼调到很高就变成"被空气托着" */
export function Parachute() {
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="parachute">
      <motion.div
        className="flex flex-col items-center cursor-grab active:cursor-grabbing"
        drag={!reduce}
        dragElastic={0.85}
        dragTransition={{ power: 0.12, timeConstant: 420, bounceStiffness: 120, bounceDamping: 26 }}
        whileDrag={{ rotate: 4 }}
      >
        <span className="anim-swing block h-7 w-20 origin-bottom rounded-t-full bg-brand-400" />
        <span className="h-10 w-0.5 bg-brand-300" />
        <span className="h-3 w-3 rounded-full bg-brand-500" />
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- 弹跳球 */

/** 弹跳球：CSS 做抛物线位移，落地点放一个压扁的影子——影子缩放就是"高度提示" */
export function BouncingBall() {
  return (
    <div className="relative h-full w-full overflow-hidden" data-lab="bounce">
      <span className="anim-bounce absolute bottom-12 left-1/2 h-7 w-7 -translate-x-1/2 rounded-full bg-brand-500" />
      <span className="absolute bottom-8 left-1/2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-black/15 blur-[2px]" />
      <span className="absolute bottom-4 left-0 right-0 mx-auto h-0.5 w-24 bg-line-base" />
    </div>
  );
}

/* ---------------------------------------------------------------- 链条甩动 */

/** 链条甩动：SVG 虚线的 dashoffset 来回跑，像鞭子抽过去 */
export function WhipLash() {
  const [round, setRound] = useState(0);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="whip">
      <svg width="200" height="70" viewBox="0 0 200 70">
        <motion.path
          key={round}
          d="M 10 35 C 60 5, 90 65, 130 35 S 180 8, 190 35"
          fill="none"
          stroke="#7644A7"
          strokeWidth={3}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.55, ease: EASE }}
        />
        <motion.circle
          key={`dot-${round}`}
          r={0}
          fill="#9C6BC9"
          initial={{ cx: 190, cy: 35, r: 0 }}
          animate={{ cx: 190, cy: 35, r: [0, 6, 4] }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.45 }}
        />
      </svg>
      <button
        type="button"
        onClick={() => setRound((n) => n + 1)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        抽一下
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 陀螺 */

/** 陀螺：快转 + 轻微摆动（wobble），停下来之前轴心会画圈 */
export function SpinningTop() {
  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="top">
      <div className="relative h-20 w-20">
        <span className="anim-wobble absolute inset-0">
          <span className="anim-orbit-fast absolute inset-0">
            <span className="absolute left-1/2 top-0 h-8 w-8 -translate-x-1/2 rounded-full bg-brand-500 shadow-card" />
          </span>
        </span>
        <span className="absolute bottom-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-brand-500/25 blur-[3px]" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 抛接物 */

/**
 * 抛接物：松手后按抛物线飞出。
 * x 匀速、y 先上后下——两条轨道分别插值，就是最省事的抛射近似。
 */
export function TossCatch() {
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  const [landed, setLanded] = useState(false);

  const toss = async () => {
    if (reduce) return;
    setLanded(false);
    await controls.start({
      x: [0, 70, 130],
      y: [0, -54, 0],
      transition: {
        duration: 1.1,
        ease: "linear",
        x: { times: [0, 0.35, 1] },
        y: { times: [0, 0.35, 1], ease: ["easeOut", "easeIn"] },
      },
    });
    setLanded(true);
    await controls.start({ scale: [1, 1.18, 1], transition: { duration: 0.3, ease: EASE } });
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="toss">
      <div className="relative h-24 w-56">
        <motion.div
          className="absolute bottom-0 left-2 h-8 w-8 rounded-full bg-brand-500 shadow-card"
          animate={controls}
          initial={{ x: 0, y: 0 }}
        />
        <motion.span
          className="absolute bottom-0 left-2 h-1 w-8 rounded-full bg-brand-500/25 blur-[2px]"
          animate={landed ? { scaleX: 1.6, opacity: 0.5 } : { scaleX: 1, opacity: 0.2 }}
          transition={{ duration: 0.2 }}
        />
      </div>
      <button
        type="button"
        onClick={() => void toss()}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        抛出去
      </button>
    </div>
  );
}
