/**
 * 动效原语：页面过渡、逐项入场、数字滚动、极光背景、水滴分溅。
 *
 * 为什么单独抽一层而不是各处写 `motion.div`：
 * - 参数（缓动、位移量、时长）必须统一，否则同一产品里会出现「三种弹速」；
 * - `prefers-reduced-motion` 只在这层判断一次，页面里不用反复处理；
 * - 液体类效果（水滴分溅、极光）用的人多、写起来长，收在这里才不会复制粘贴。
 */

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Variants,
} from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { EASE, pageVariants } from "../lib/motion";

/* ------------------------------------------------------------------ 页面 */

/** 页面容器：路由切换时由 <AnimatePresence> 驱动淡入淡出 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">
      {children}
    </motion.div>
  );
}

/** 逐项入场：容器 + 子项成对使用 */
export function Stagger({
  children,
  className,
  variants,
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
}) {
  return (
    <motion.div className={className} variants={variants} initial="initial" animate="animate">
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ 数字 */

/**
 * 数字滚动：从 0 递增到目标值。
 * 非数字（例如「—」）直接原样渲染，调用方不需要分支。
 */
export function CountUp({
  value,
  className,
  duration = 0.9,
}: {
  value: number | string;
  className?: string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const numeric = typeof value === "number";
  const mv = useMotionValue(0);
  const shown = useTransform(mv, (latest) => Math.round(latest).toString());

  useEffect(() => {
    if (!numeric) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: EASE });
    return () => controls.stop();
  }, [duration, mv, numeric, reduce, value]);

  if (!numeric) return <span className={className}>{value}</span>;
  return <motion.span className={className}>{shown}</motion.span>;
}

/* ------------------------------------------------------------------ 背景 */

/**
 * 极光背景：三团缓慢漂移的柔光。
 *
 * 只做「空状态 / 页头」的底纹，不铺满数据区——深色渐层会吃掉表格的可读性，
 * 这也是企业后台最容易翻车的地方。透明度压在 0.5 以下。
 */
export function AuroraField({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const blobs = useMemo(
    () => [
      { size: 420, color: "rgba(118,68,167,0.20)", x: "-12%", y: "-30%", dur: 22 },
      { size: 360, color: "rgba(94,124,224,0.16)", x: "58%", y: "-10%", dur: 26 },
      { size: 300, color: "rgba(180,120,220,0.14)", x: "25%", y: "45%", dur: 19 },
    ],
    [],
  );

  return (
    <div className={"pointer-events-none absolute inset-0 overflow-hidden " + className} aria-hidden="true">
      {blobs.map((blob, index) => (
        <motion.span
          key={index}
          className="absolute rounded-full blur-2xl"
          style={{
            width: blob.size,
            height: blob.size,
            left: blob.x,
            top: blob.y,
            background: `radial-gradient(circle at 50% 50%, ${blob.color}, transparent 70%)`,
          }}
          animate={
            reduce
              ? undefined
              : {
                  x: [0, 26, -18, 0],
                  y: [0, -22, 14, 0],
                  scale: [1, 1.08, 0.97, 1],
                }
          }
          transition={{ duration: blob.dur, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 水滴 */

interface Droplet {
  angle: number;
  distance: number;
  size: number;
  delay: number;
  color: string;
}

/**
 * 水滴分溅：一次性的「液体」反馈。
 *
 * 用在哪：新建画布节点、发布版本、消息落定——都是「一个动作刚刚发生了」的时刻。
 * 不用在 hover/滚动上，那样会变成噪音。
 *
 * 实现：两层同心环扩散（涟漪）+ 一圈水滴沿半径飞出并缩小，
 * 全部 `pointer-events-none`，不会挡住画布上的交互。
 */
export function DropletSplash({
  x,
  y,
  onDone,
  tone = "brand",
}: {
  x: number;
  y: number;
  onDone?: () => void;
  tone?: "brand" | "success";
}) {
  const reduce = useReducedMotion();
  const palette =
    tone === "success"
      ? { ring: "#52C41A", core: "#95DE64", drop: "#73D13D" }
      : { ring: "#7644A7", core: "#B995DC", drop: "#8B5FBF" };

  const droplets: Droplet[] = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 + (i % 2 ? 0.16 : 0);
        return {
          angle,
          distance: 34 + (i % 3) * 18,
          size: i % 3 === 0 ? 9 : i % 3 === 1 ? 6 : 4,
          delay: (i % 5) * 0.016,
          color: i % 2 ? palette.drop : palette.core,
        };
      }),
    [palette.core, palette.drop],
  );

  useEffect(() => {
    if (!onDone) return;
    const timer = window.setTimeout(onDone, reduce ? 60 : 840);
    return () => window.clearTimeout(timer);
  }, [onDone, reduce]);

  if (reduce) return null;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
      aria-hidden="true"
    >
      {/* 涟漪：两层同心环错开扩散 */}
      {[0, 0.14].map((delay, index) => (
        <motion.span
          key={`ring-${index}`}
          className="absolute rounded-full border-2"
          style={{
            borderColor: palette.ring,
            left: -26,
            top: -26,
            width: 52,
            height: 52,
          }}
          initial={{ scale: 0.3, opacity: 0.6 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ duration: 0.78, ease: EASE, delay }}
        />
      ))}

      {/* 柔光：一圈模糊光晕，让「落点」在浅色背景上也能被看到 */}
      <motion.span
        className="absolute rounded-full blur-md"
        style={{ background: palette.core, left: -18, top: -18, width: 36, height: 36 }}
        initial={{ scale: 0.5, opacity: 0.55 }}
        animate={{ scale: 2.2, opacity: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />

      {/* 水滴：沿半径飞出 */}
      {droplets.map((drop, index) => {
        const dx = Math.cos(drop.angle) * drop.distance;
        const dy = Math.sin(drop.angle) * drop.distance;
        return (
          <motion.span
            key={`drop-${index}`}
            className="absolute rounded-full"
            style={{
              width: drop.size,
              height: drop.size,
              background: drop.color,
              left: -drop.size / 2,
              top: -drop.size / 2,
            }}
            initial={{ x: 0, y: 0, opacity: 0.95, scale: 1 }}
            animate={{ x: dx, y: dy, opacity: 0, scale: 0.35 }}
            transition={{ duration: 0.62, ease: EASE, delay: drop.delay }}
          />
        );
      })}

      {/* 中心一闪：强化「落点」 */}
      <motion.span
        className="absolute rounded-full"
        style={{ background: palette.core, left: -5, top: -5, width: 10, height: 10 }}
        initial={{ scale: 1, opacity: 0.9 }}
        animate={{ scale: 0.2, opacity: 0 }}
        transition={{ duration: 0.34, ease: "easeOut" }}
      />
    </div>
  );
}

/** 触发水滴反馈的小工具：返回当前要画的抛物线点与一个 trigger */
export function useSplash(): [ { x: number; y: number; key: number } | null, (x: number, y: number) => void ] {
  const [splash, setSplash] = useState<{ x: number; y: number; key: number } | null>(null);
  const fire = (x: number, y: number) => setSplash({ x, y, key: Date.now() });
  return [splash, fire];
}

/** 呼吸点：用于「服务已连接」这类持续健康态，节拍比心跳慢，不抢注意力 */
export function BreathingDot({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={"relative inline-flex h-1.5 w-1.5 " + className}>
      <span className="absolute inset-0 rounded-full bg-current" />
      {!reduce && (
        <motion.span
          className="absolute inset-0 rounded-full bg-current"
          animate={{ scale: [1, 2.4, 1], opacity: [0.45, 0, 0.45] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
    </span>
  );
}

/** 光标：SSE 流式时跟在最后一个字后面闪 */
export function StreamCursor() {
  const reduce = useReducedMotion();
  return (
    <motion.span
      className="ml-0.5 inline-block h-4 w-[2px] align-middle"
      style={{ backgroundColor: "#7644A7" }}
      animate={reduce ? { opacity: 1 } : { opacity: [1, 0.15, 1] }}
      transition={reduce ? undefined : { duration: 0.95, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/** 数值变化时的高亮闪烁：让「刚刚更新」这件事可见 */
export function useFlash(value: unknown): boolean {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 620);
    return () => window.clearTimeout(timer);
  }, [value]);
  return flash;
}
