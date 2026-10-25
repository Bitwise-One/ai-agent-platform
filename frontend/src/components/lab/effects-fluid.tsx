/**
 * 液体组：Gooey 磁吸、液态形变、水滴分溅。
 *
 * 这三个的共同点是「有表面张力」——元素靠拢时会粘连、拉开时会拉丝断裂。
 * 实现上没用 canvas 或 WebGL，全部靠 SVG 滤镜 + 不同刚度的 spring 叠加：
 * 前者负责「融合」，后者负责「迟滞」。两者一起才会像液体，只做其中一个就是果冻。
 */

import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

import { DropletSplash } from "../motion";

/* ---------------------------------------------------------------- Gooey 水滴 */

/**
 * Gooey 融合的关键是 `feGaussianBlur + feColorMatrix`：
 * 先模糊把相邻圆形的 alpha 抹开，再用 alpha 对比度把「半透明重叠区」压成实心，
 * 于是两个圆靠近时会长出一条连接的桥——这就是表面张力。
 */
export function GooeyBlobs() {
  const stage = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // 三种刚度 = 三种跟随延迟：近的跟得紧、远的拖得慢，才会出现「拉丝—断裂」
  const fast = { stiffness: 220, damping: 22, mass: 0.5 };
  const mid = { stiffness: 120, damping: 16, mass: 0.7 };
  const slow = { stiffness: 68, damping: 12, mass: 0.95 };

  const ax = useSpring(x, fast);
  const ay = useSpring(y, fast);
  const bx = useSpring(x, mid);
  const by = useSpring(y, mid);
  const cx = useSpring(x, slow);
  const cy = useSpring(y, slow);

  const onMove = (event: RPointerEvent<HTMLDivElement>) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return;
    x.set(event.clientX - rect.left - rect.width / 2);
    y.set(event.clientY - rect.top - rect.height / 2);
  };

  const park = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <div
      ref={stage}
      onPointerMove={onMove}
      onPointerLeave={park}
      data-lab="gooey"
      className="relative h-full w-full cursor-crosshair"
    >
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="lab-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="11" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>

      <div
        className="absolute inset-0"
        style={{ filter: reduce ? undefined : "url(#lab-goo)" }}
        aria-hidden="true"
      >
        {/* 大球不动：它是「被追逐」的主体 */}
        <span className="absolute left-1/2 top-1/2 -ml-[34px] -mt-[34px] h-[68px] w-[68px] rounded-full bg-brand-500" />
        <motion.span
          style={{ x: ax, y: ay }}
          className="absolute left-1/2 top-1/2 -ml-[24px] -mt-[24px] h-12 w-12 rounded-full bg-brand-500"
        />
        <motion.span
          style={{ x: bx, y: by }}
          className="absolute left-1/2 top-1/2 -ml-[16px] -mt-[16px] h-8 w-8 rounded-full bg-brand-400"
        />
        <motion.span
          style={{ x: cx, y: cy }}
          className="absolute left-1/2 top-1/2 -ml-[10px] -mt-[10px] h-5 w-5 rounded-full bg-brand-600"
        />
      </div>

      <span className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-ink-tertiary">
        移动光标，看它们粘连、拉丝、断裂
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 液态形变 */

/**
 * 不规则的 border-radius 关键帧 + 缓慢自转 = 一颗在呼吸的液滴。
 * 用 CSS keyframes（.anim-blob）而不是 JS 逐帧算：形变和旋转都跑在合成线程，
 * 而且四段圆角必须严格同相位，交给 CSS 才不会互相等。
 */
export function LiquidLoader() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-5" data-lab="liquid">
      <div className="relative">
        <div
          className="anim-blob h-[88px] w-[88px] bg-brand-500"
          style={{
            boxShadow:
              "inset 0 -8px 18px rgba(0,0,0,0.16), inset 0 6px 14px rgba(255,255,255,0.28), 0 10px 26px -12px rgba(105,217,179,0.7)",
          }}
        />
        {/* 高光：液滴没有高光就只是一团色块 */}
        <span className="pointer-events-none absolute left-[22%] top-[18%] h-3.5 w-5 rounded-full bg-white/55 blur-[2px]" />
      </div>

      <div className="flex items-center gap-2 text-caption text-ink-tertiary">
        <motion.span
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          正在同步知识库
        </motion.span>
        <span className="tabular">47%</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 水滴分溅 */

interface Burst {
  x: number;
  y: number;
  key: number;
  tone: "brand" | "success";
}

/**
 * 点击溅射：主水花落地后 130ms 再补一发偏移的小水花。
 * 真实的液体撞到平面会「先铺开、再二次飞溅」，单发水花看起来像一次性贴图。
 */
export function SplashStage() {
  const stage = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const fire = (event: RPointerEvent<HTMLDivElement>) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const key = (seq.current += 1);

    setBursts((prev) => [...prev.slice(-4), { x, y, key, tone: "brand" }]);

    const timer = window.setTimeout(() => {
      setBursts((prev) => [
        ...prev.slice(-4),
        { x: x + 27, y: y - 15, key: key + 5000, tone: "brand" },
      ]);
    }, 130);
    timers.current.push(timer);
  };

  const drop = (key: number) => {
    setBursts((prev) => prev.filter((b) => b.key !== key));
  };

  return (
    <div
      ref={stage}
      onPointerDown={fire}
      data-lab="splash"
      className="relative h-full w-full cursor-pointer select-none"
    >
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
        <span className="text-body text-ink-secondary">点击这片空白</span>
        <span className="text-[11px] text-ink-tertiary">一次点击 = 主溅射 + 130ms 二次溅射</span>
      </div>

      {bursts.map((burst) => (
        <div
          key={burst.key}
          className="pointer-events-none absolute"
          style={{ left: burst.x, top: burst.y }}
        >
          <DropletSplash x={0} y={0} tone={burst.tone} onDone={() => drop(burst.key)} />
        </div>
      ))}
    </div>
  );
}
