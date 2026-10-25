/**
 * 空间组：把平面变成有体积的容器。
 *
 * 这一组全部依赖 perspective + 3D transform。两条经验：
 * 1. perspective 要给在「父层」上，给在被旋转元素自己身上只会得到奇怪的中心投影；
 * 2. 背面内容默认会镜像，必须 backface-visibility:hidden，否则字是反的。
 */

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 翻转卡 */

/** 翻转卡：点击绕 Y 轴翻 180°，正反两面分别只在自己的半圈可见 */
export function FlipCard() {
  const [flipped, setFlipped] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ perspective: 900 }} data-lab="flip">
      <motion.div
        className="relative h-28 w-40 cursor-pointer"
        style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: reduce ? 0 : 0.65, ease: EASE }}
        onClick={() => setFlipped((v) => !v)}
      >
        <Face className="bg-brand-500 text-white" label="正面 · 路由配置" />
        <Face className="bg-white text-ink-primary" label="背面 · 高级选项" rotate />
      </motion.div>
    </div>
  );
}

function Face({ className, label, rotate = false }: { className: string; label: string; rotate?: boolean }) {
  return (
    <div
      className={
        "absolute inset-0 flex items-center justify-center rounded-card border border-line-split text-caption font-medium " +
        className
      }
      style={{
        backfaceVisibility: "hidden",
        transform: rotate ? "rotateY(180deg)" : undefined,
      }}
    >
      {label}
    </div>
  );
}

/* ---------------------------------------------------------------- 立方体 */

/** 立方体：六个面各自 translateZ 到半径上，父容器自转 */
export function CubeSpin() {
  const reduce = useReducedMotion();
  const faces = [
    { transform: "translateZ(44px)", label: "前" },
    { transform: "rotateY(180deg) translateZ(44px)", label: "后" },
    { transform: "rotateY(90deg) translateZ(44px)", label: "右" },
    { transform: "rotateY(-90deg) translateZ(44px)", label: "左" },
    { transform: "rotateX(90deg) translateZ(44px)", label: "上" },
    { transform: "rotateX(-90deg) translateZ(44px)", label: "下" },
  ];

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ perspective: 700 }} data-lab="cube">
      {/* 外层自转、内层翻滚：两条 CSS 动画各管一个轴，互不覆盖 */}
      <span className={reduce ? "" : "anim-orbit-fast"} style={{ transformStyle: "preserve-3d" }}>
        <span className={reduce ? "" : "anim-tumble"} style={{ transformStyle: "preserve-3d", display: "block" }}>
          <span className="relative block h-20 w-20" style={{ transformStyle: "preserve-3d" }}>
            {faces.map((face) => (
              <span
                key={face.label}
                className="absolute inset-0 flex items-center justify-center rounded-md border border-brand-300/70 bg-brand-100/80 text-caption text-brand-600"
                style={{ transform: face.transform }}
              >
                {face.label}
              </span>
            ))}
          </span>
        </span>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 封面流 */

/** 封面流：中间正对、两侧旋转并后退——用 rotateY + translateZ 就能得到 */
export function Coverflow() {
  const [active, setActive] = useState(1);
  const items = ["工作流", "Agent", "知识库", "模型"];
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ perspective: 800 }} data-lab="coverflow">
      {/* 必须给容器定尺寸：绝对定位的子元素会去找最近的 positioned 祖先，这里必须是它自己 */}
      <div className="relative h-24 w-40" style={{ transformStyle: "preserve-3d" }}>
        {items.map((item, index) => {
          const offset = index - active;
          return (
            <motion.button
              key={item}
              type="button"
              onClick={() => setActive(index)}
              className="absolute left-1/2 top-1/2 flex h-20 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-card border border-line-split bg-surface text-caption text-ink-primary shadow-card"
              animate={{
                x: offset * 52,
                z: -Math.abs(offset) * 60,
                rotateY: offset === 0 ? 0 : offset > 0 ? -32 : 32,
                opacity: Math.abs(offset) > 2 ? 0 : 1,
              }}
              transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
            >
              {item}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 牌堆发牌 */

/** 牌堆：点一下把顶牌发到右边，剩下的牌补位——发牌是一个"队列出队"的过程 */
export function DealDeck() {
  const [order, setOrder] = useState([0, 1, 2, 3]);
  const reduce = useReducedMotion();
  const labels = ["A", "B", "C", "D"];

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="deck">
      <div className="relative h-20 w-32">
        {order.map((card, index) => (
          <motion.div
            key={card}
            className="absolute inset-0 flex items-center justify-center rounded-card border border-line-split bg-surface text-subtitle font-semibold text-brand-600 shadow-card"
            animate={{ y: -index * 3, scale: 1 - index * 0.04 }}
            transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
          >
            {labels[card]}
          </motion.div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOrder((prev) => [...prev.slice(1), prev[0]])}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        发一张
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 折页 */

/** 折页：两半绕中缝翻，像翻开一本小册子 */
export function FoldPanels() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ perspective: 900 }} data-lab="fold">
      <div
        className="relative h-28 w-48 cursor-pointer"
        style={{ transformStyle: "preserve-3d" }}
        onClick={() => setOpen((v) => !v)}
      >
        {[0, 1].map((half) => (
          <motion.div
            key={half}
            className="absolute top-0 h-full w-1/2 overflow-hidden rounded-card border border-line-split bg-surface"
            style={{
              left: half === 0 ? 0 : "50%",
              originX: half === 0 ? 0 : 1,
            }}
            animate={{ rotateY: open ? (half === 0 ? -28 : 28) : 0 }}
            transition={{ duration: reduce ? 0 : 0.55, ease: EASE }}
          >
            <div className={half === 0 ? "pl-3 pt-2.5 text-caption text-ink-primary" : "pl-2 pt-2.5 text-caption text-ink-primary"}>
              {half === 0 ? "左页 · 配置" : "右页 · 说明"}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 开门 */

/** 开门：门扇绕左边 swing 开，内容在门后淡入——顺序决定"里面有什么"的揭示感 */
export function DoorOpen() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ perspective: 900 }} data-lab="door">
      <div
        className="relative h-32 w-28 cursor-pointer overflow-hidden rounded-card border border-line-split bg-surface"
        onClick={() => setOpen((v) => !v)}
      >
        <motion.div
          className="absolute inset-0 flex items-center justify-center bg-brand-50 text-caption text-brand-600"
          animate={{ opacity: open ? 1 : 0.4, scale: open ? 1 : 0.96 }}
          transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : open ? 0.25 : 0, ease: EASE }}
        >
          门后的世界
        </motion.div>
        <motion.div
          className="absolute inset-0 flex items-center justify-center rounded-card border border-line-split bg-brand-500 text-caption text-white"
          style={{ originX: 0 }}
          animate={{ rotateY: open ? -105 : 0 }}
          transition={{ duration: reduce ? 0 : 0.6, ease: EASE }}
        >
          推门
        </motion.div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 圆柱滚动 */

/** 圆柱：每项沿圆周分布（rotateY(i*40deg) + translateZ），转容器就是滚圆柱 */
export function CylinderScroll() {
  const reduce = useReducedMotion();
  const items = ["路由", "检索", "生成", "审核", "落库", "上报", "重试", "缓存", "告警"];

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden" style={{ perspective: 700 }} data-lab="cylinder">
      <span className={reduce ? "" : "anim-orbit"} style={{ transformStyle: "preserve-3d", display: "block" }}>
        <span className="relative block h-16 w-16" style={{ transformStyle: "preserve-3d" }}>
          {items.map((item, index) => (
            <span
              key={item}
              className="absolute left-1/2 top-1/2 flex h-8 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border border-brand-200 bg-white/90 text-caption text-brand-600"
              style={{ transform: `rotateY(${index * 40}deg) translateZ(96px)` }}
            >
              {item}
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 螺旋 */

/** 螺旋：每项 rotate + 位移沿半径外扩，形成一个静态的三维螺旋 */
export function HelixTower() {
  const reduce = useReducedMotion();
  const rings = Array.from({ length: 6 }, (_, i) => i);

  return (
    <div className="flex h-full w-full items-center justify-center" style={{ perspective: 700 }} data-lab="helix">
      <span className={reduce ? "" : "anim-orbit-slow"} style={{ transformStyle: "preserve-3d", display: "block" }}>
        <span className={reduce ? "" : "anim-tumble"} style={{ transformStyle: "preserve-3d", display: "block" }}>
          <span className="relative block h-24 w-24" style={{ transformStyle: "preserve-3d" }}>
            {rings.map((ring) => (
              <span
                key={ring}
                className="absolute left-1/2 top-1/2 h-4 w-4 rounded-full bg-brand-400"
                style={{
                  transform: `rotateX(${ring * 60}deg) translateZ(${22 + ring * 4}px)`,
                  marginLeft: -8,
                  marginTop: -8,
                }}
              />
            ))}
          </span>
        </span>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 透视网格 */

/** 透视网格：整块 rotateX 60° 铺成"地板"，hover 的单格抬起来 */
export function PerspectiveGrid() {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ perspective: 620 }}
      onPointerLeave={() => setHover(null)}
      data-lab="grid3d"
    >
      <div
        className="grid grid-cols-6 gap-1.5"
        style={{ transform: "rotateX(58deg)", transformStyle: "preserve-3d" }}
      >
        {Array.from({ length: 18 }, (_, i) => (
          <motion.span
            key={i}
            className="h-5 w-5 rounded-sm bg-brand-200"
            animate={{ translateZ: hover === i ? 18 : 0, backgroundColor: hover === i ? "#39B69A" : "#B7F3E2" }}
            transition={{ duration: reduce ? 0 : 0.26, ease: EASE }}
            onPointerEnter={() => setHover(i)}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 翻页时钟 */

/** 翻页时钟：上半页翻下去、下半页翻上来，合起来就是一次翻页 */
export function FlipClock() {
  const [tick, setTick] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const digit = tick % 10;

  return (
    <div className="flex h-full w-full items-center justify-center gap-2" data-lab="flipclock">
      <div className="relative h-14 w-11 overflow-hidden rounded-card border border-line-split bg-surface" style={{ perspective: 500 }}>
        {/* 静止的上半：只露下半截数字 */}
        <span className="absolute inset-x-0 top-0 h-1/2 overflow-hidden border-b border-line-split">
          <span className="tabular absolute top-0 flex h-14 w-11 items-center justify-center text-title font-semibold text-ink-primary">
            {(digit + 1) % 10}
          </span>
        </span>
        {/* 静止的下半：完整数字的上半截 */}
        <span className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden">
          <span className="tabular absolute bottom-0 flex h-14 w-11 items-center justify-center text-title font-semibold text-ink-primary">
            {digit}
          </span>
        </span>

        {/* 翻动中的上半页 */}
        {!reduce && (
          <motion.span
            key={`top-${digit}`}
            className="absolute inset-x-0 top-0 h-1/2 origin-bottom overflow-hidden rounded-t-card bg-surface"
            initial={{ rotateX: 0 }}
            animate={{ rotateX: -90 }}
            transition={{ duration: 0.32, ease: "easeIn" }}
            style={{ backfaceVisibility: "hidden" }}
          >
            <span className="tabular absolute top-0 flex h-14 w-11 items-center justify-center text-title font-semibold text-ink-primary">
              {digit}
            </span>
          </motion.span>
        )}
      </div>
      <span className="text-caption text-ink-tertiary">每 2s 翻一页</span>
    </div>
  );
}
