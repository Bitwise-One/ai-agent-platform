/**
 * 物理组：弹簧拖拽、磁力吸附、布局洗牌。
 *
 * 这一组不靠「关键帧」而靠「物理参数」——刚度、阻尼、质量决定了手感。
 * 调参经验：手指能接受的甩动回弹大约是 stiffness 300 / damping 16；
 * 阻尼一高就变成"机械归位"，一点乐趣都没有。
 */

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";

import { spring } from "../../lib/motion";

/* ---------------------------------------------------------------- 弹簧拖拽 */

export function DragCard() {
  const reduce = useReducedMotion();
  const [speed, setSpeed] = useState(0);

  return (
    <div className="relative flex h-full w-full items-center justify-center" data-lab="drag">
      {/* 约束框：让「能拖多远」这件事可见，否则用户会以为卡住了 */}
      <div className="pointer-events-none absolute h-[132px] w-[220px] rounded-card border border-dashed border-line-base" />

      <motion.div
        drag={!reduce}
        dragSnapToOrigin
        dragElastic={0.22}
        dragConstraints={{ left: -70, right: 70, top: -40, bottom: 40 }}
        dragTransition={{ bounceStiffness: 330, bounceDamping: 15, power: 0.35 }}
        whileDrag={{ scale: 1.05, cursor: "grabbing", rotate: -1.5 }}
        whileHover={{ scale: 1.02 }}
        onDragEnd={(_, info) =>
          setSpeed(Math.round(Math.hypot(info.velocity.x, info.velocity.y)))
        }
        className="relative z-10 flex h-[76px] w-[132px] cursor-grab flex-col justify-center gap-0.5 rounded-card border border-line-base bg-surface px-3.5 shadow-popup"
      >
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          <span className="text-body text-ink-primary">抓我甩一下</span>
        </div>
        <span className="text-[11px] text-ink-tertiary">松手按惯性回弹</span>
      </motion.div>

      <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-2">
        <span className="text-[11px] text-ink-tertiary">甩出速度</span>
        <motion.span
          key={speed}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="tabular text-caption text-brand-600"
        >
          {speed} px/s
        </motion.span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 磁力按钮 */

/**
 * 磁吸：光标进入按钮周围的「引力场」后，按钮朝光标偏移；
 * 内部文字再乘一个 0.35 的系数，形成视差——按钮"追"光标，文字"追"按钮。
 * 这层错位是廉价塑料感和真的磁铁之间的区别。
 */
export function MagneticButton() {
  const field = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);

  const sx = useSpring(mx, { stiffness: 260, damping: 18, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 260, damping: 18, mass: 0.6 });
  const labelX = useTransform(sx, (v) => v * 0.35);
  const labelY = useTransform(sy, (v) => v * 0.35);
  const haloX = useTransform(sx, (v) => v * 0.8);
  const haloY = useTransform(sy, (v) => v * 0.8);

  const onMove = (event: RPointerEvent<HTMLDivElement>) => {
    const rect = field.current?.getBoundingClientRect();
    if (!rect) return;
    // 以按钮中心为原点，半径 150px 内才有引力
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const pull = Math.min(1, 150 / Math.max(48, Math.hypot(dx, dy))) * 0.42;
    mx.set(dx * pull);
    my.set(dy * pull);
  };

  const release = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <div
      ref={field}
      onPointerMove={onMove}
      onPointerLeave={release}
      data-lab="magnet"
      className="relative flex h-full w-full items-center justify-center"
    >
      <motion.span
        style={{ x: haloX, y: haloY }}
        className="pointer-events-none absolute h-[92px] w-[92px] rounded-full bg-brand-100/70 blur-xl"
        aria-hidden="true"
      />
      <motion.button
        type="button"
        style={{ x: sx, y: sy }}
        whileTap={{ scale: 0.95 }}
        className="relative z-10 flex h-10 items-center gap-2 rounded-control bg-brand-500 px-5 text-body font-medium text-white shadow-[0_10px_24px_-12px_rgba(105,217,179,0.9)]"
      >
        <motion.span style={{ x: labelX, y: labelY }} className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M13.5 4c3.5.5 6 3 6.5 6.5-1.8 3.6-5.3 6.5-9 8l-3-3c1.5-3.7 4.4-7.2 8-9Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          靠近我
        </motion.span>
      </motion.button>

      <span className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-ink-tertiary">
        光标进入 150px 引力场，按钮与被吸引的文字错位跟随
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 布局洗牌 */

const TILES = [
  { id: "router", label: "路由", tone: "bg-brand-500 text-white" },
  { id: "order", label: "订单", tone: "bg-brand-100 text-brand-700" },
  { id: "refund", label: "退款", tone: "bg-brand-200 text-brand-700" },
  { id: "tech", label: "技术", tone: "bg-brand-300 text-white" },
  { id: "kb", label: "知识", tone: "bg-brand-400 text-white" },
  { id: "human", label: "转人工", tone: "bg-brand-600 text-white" },
];

/**
 * FLIP 洗牌：只改数据顺序，位置补间交给 `layout`。
 * 这是 framer 最被低估的能力——列表筛选、看板拖拽、排序都能直接受益，
 * 而且不需要给每个元素算 from/to。
 */
export function ShuffleGrid() {
  const [order, setOrder] = useState(() => TILES.map((t) => t.id));
  const [count, setCount] = useState(0);

  const shuffle = () => {
    setOrder((prev) => {
      const next = [...prev];
      // Fisher–Yates，并保证至少有一个位置真的变了
      do {
        for (let i = next.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [next[i], next[j]] = [next[j], next[i]];
        }
      } while (next.every((id, i) => id === prev[i]));
      return next;
    });
    setCount((n) => n + 1);
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="shuffle">
      {/* 限宽成 3 列：6 个瓦片铺成 3×2 才对称，否则会出现 5+1 的孤行 */}
      <div className="flex max-w-[196px] flex-wrap justify-center gap-2.5">
        {order.map((id) => {
          const tile = TILES.find((t) => t.id === id);
          if (!tile) return null;
          return (
            <motion.div
              key={id}
              layout
              transition={spring}
              whileHover={{ y: -3 }}
              className={
                "flex h-[58px] w-[58px] items-center justify-center rounded-card text-caption " +
                tile.tone
              }
            >
              {tile.label}
            </motion.div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={shuffle}
        className="flex items-center gap-1.5 rounded-control border border-line-base bg-surface px-3 py-1.5 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        <motion.svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          animate={{ rotate: count * 180 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          aria-hidden="true"
        >
          <path
            d="M4 7h4l8 10h4M16 4l4 3-4 3M4 17h4l2.5-3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
        洗牌
      </button>
    </div>
  );
}
