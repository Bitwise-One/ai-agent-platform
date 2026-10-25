/**
 * 手势组：靠指针/触摸驱动的交互。
 *
 * 这一组的共同点：动画不是"播"出来的，而是"被手拽出来"的。
 * 所以判据是**跟手**——位移必须和指针同步（不能有 transition 延迟），
 * 松手之后才允许出现惯性/回弹。搞反了就会觉得"拖不动"。
 */

import { motion, Reorder, useMotionValue, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { LoadingRing } from "../motion";

/* ---------------------------------------------------------------- 滑动删除 */

/** 滑动删除：拖过 96px 就飞出去，否则弹回——阈值要"过半才触发"，避免误删 */
export function SwipeDismiss() {
  const reduce = useReducedMotion();
  const [items, setItems] = useState([
    { id: 1, text: "refund-router · 退款意图路由" },
    { id: 2, text: "kb-retriever · 知识库检索" },
    { id: 3, text: "reply-writer · 答复生成" },
  ]);

  return (
    <ul className="flex h-full w-full flex-col justify-center gap-2 px-5" data-lab="swipe">
      {items.map((item) => (
        <motion.li
          key={item.id}
          className="relative flex h-9 items-center overflow-hidden rounded-control border border-line-split bg-surface"
          drag={reduce ? false : "x"}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.85}
          onDragEnd={(_, info) => {
            if (info.offset.x < -96) setItems((prev) => prev.filter((one) => one.id !== item.id));
          }}
        >
          <span className="flex-1 truncate px-3 text-caption text-ink-primary">{item.text}</span>
          <span className="shrink-0 pr-3 text-[11px] text-[#FF9DA6]">删除</span>
        </motion.li>
      ))}
      {items.length === 0 && (
        <li className="py-3 text-center text-caption text-ink-tertiary">全部删除了（刷新页面可重置）</li>
      )}
    </ul>
  );
}

/* ---------------------------------------------------------------- 长按进度 */

/** 长按进度：按住时环形进度填充，松手即断；填满才触发——防误触 */
export function LongPress() {
  const reduce = useReducedMotion();
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fired, setFired] = useState(false);

  useEffect(() => {
    if (!holding || reduce) return;
    const timer = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          window.clearInterval(timer);
          setFired(true);
          return 100;
        }
        return p + 4;
      });
    }, 40);
    return () => window.clearInterval(timer);
  }, [holding, reduce]);

  const radius = 20;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="longpress">
      <motion.button
        type="button"
        className="relative flex h-14 w-14 items-center justify-center rounded-full border border-line-base bg-surface text-caption text-ink-secondary"
        onPointerDown={() => setHolding(true)}
        onPointerUp={() => setHolding(false)}
        onPointerLeave={() => setHolding(false)}
        animate={{ scale: holding ? 0.96 : 1 }}
        onClick={() => {
          setProgress(0);
          setFired(false);
        }}
      >
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r={radius} fill="none" stroke="#34453D" strokeWidth={3} />
          <circle
            cx="24"
            cy="24"
            r={radius}
            fill="none"
            stroke="#0D7665"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress / 100)}
          />
        </svg>
        <span className="relative">{fired ? "已触发" : "按住"}</span>
      </motion.button>
      <span className="text-[11px] text-ink-tertiary">
        {fired ? "长按成功，点击复位" : `长按 ${Math.round(progress / 4) * 4}%`}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 拖拽排序 */

/** 拖拽排序：Reorder 自己处理位置补间，只需要保证 key 稳定 */
export function DragReorder() {
  const reduce = useReducedMotion();
  const [items, setItems] = useState(["意图路由", "知识检索", "工具调用", "合规审核"]);

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="reorder">
      <Reorder.Group
        axis="y"
        values={items}
        onReorder={setItems}
        className="w-40 space-y-1.5"
        as="ul"
      >
        {items.map((item) => (
          <Reorder.Item
            key={item}
            value={item}
            drag={!reduce}
            whileDrag={{ scale: 1.03, boxShadow: "0 6px 16px rgba(0,0,0,0.10)" }}
            transition={{ type: "spring", stiffness: 480, damping: 34 }}
            className="flex cursor-grab items-center gap-2 rounded-control border border-line-split bg-surface px-2.5 py-1.5 text-caption text-ink-primary active:cursor-grabbing"
          >
            <span className="text-ink-tertiary">⋮⋮</span>
            {item}
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </div>
  );
}

/* ---------------------------------------------------------------- 下拉刷新 */

/** 下拉刷新：下拉超过 56px 后松手才刷新，否则弹回——阈值和"意外滚动"拉开 */
export function PullRefresh() {
  const reduce = useReducedMotion();
  const y = useMotionValue(0);
  const [state, setState] = useState<"idle" | "ready" | "loading">("idle");

  return (
    <div className="h-full w-full overflow-hidden" data-lab="pull">
      <motion.div
        className="flex h-12 items-center justify-center gap-2 text-caption text-ink-tertiary"
        style={{ y: reduce ? 0 : y }}
        drag={reduce ? false : "y"}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.5}
        onDrag={(_, info) => setState(info.offset.y > 56 ? "ready" : "idle")}
        onDragEnd={async (_, info) => {
          if (info.offset.y > 56) {
            setState("loading");
            await new Promise((r) => setTimeout(r, 900));
          }
          setState("idle");
        }}
      >
        <LoadingRing size={14} thickness={2} className="text-brand-500" />
        {state === "loading" ? "正在刷新…" : state === "ready" ? "松手刷新" : "下拉刷新"}
      </motion.div>
      <ul className="space-y-1.5 px-5">
        {["会话数 1,286", "命中率 87%", "平均耗时 412ms"].map((row) => (
          <li key={row} className="rounded-control border border-line-split bg-surface px-3 py-2 text-caption text-ink-primary">
            {row}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- 滑动显隐 */

/** 滑动显隐：左滑露出操作，滑过中点自动展开到固定位置（不全靠手停在哪） */
export function SwipeReveal() {
  const reduce = useReducedMotion();
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <ul className="flex h-full w-full flex-col justify-center gap-2 px-5" data-lab="reveal">
      {[1, 2].map((id) => (
        <li key={id} className="relative h-9 overflow-hidden rounded-control">
          <div className="absolute inset-y-0 right-0 flex items-center gap-1.5 pr-2">
            <span className="rounded-sm bg-[#3B2428] px-2 py-1 text-[11px] text-[#FF9DA6]">删除</span>
            <span className="rounded-sm bg-surface-fill px-2 py-1 text-[11px] text-ink-secondary">编辑</span>
          </div>
          <motion.div
            className="relative flex h-full items-center rounded-control border border-line-split bg-surface px-3 text-caption text-ink-primary"
            drag={reduce ? false : "x"}
            dragConstraints={{ left: -104, right: 0 }}
            dragElastic={0.08}
            animate={{ x: openId === id ? -104 : 0 }}
            transition={{ type: "spring", stiffness: 460, damping: 34 }}
            onDragEnd={(_, info) => {
              const shouldOpen = info.offset.x < -52 || (openId === id && info.offset.x > 40);
              setOpenId(shouldOpen ? id : null);
            }}
          >
            节点 {id} · 左滑看操作
          </motion.div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- 双击放大 */

/** 双击放大：第二次点击落在 250ms 内才算双击，且以点击点为缩放中心 */
export function DoubleTapZoom() {
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState("50% 50%");
  const lastTap = useRef(0);

  const onTap = (event: ReactPointerEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastTap.current < 260) {
      const rect = event.currentTarget.getBoundingClientRect();
      setOrigin(
        `${((event.clientX - rect.left) / rect.width) * 100}% ${((event.clientY - rect.top) / rect.height) * 100}%`,
      );
      setScale((s) => (s > 1 ? 1 : 1.8));
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
  };

  return (
    <div
      className="flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden bg-surface-fill"
      onPointerDown={onTap}
      data-lab="doubletap"
    >
      <motion.div
        className="flex h-20 w-28 items-center justify-center rounded-card border border-line-split bg-surface text-caption text-ink-secondary"
        animate={{ scale }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        style={{ transformOrigin: origin }}
      >
        {scale > 1 ? "双击缩小" : "双击放大"}
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- 捏合缩放 */

/**
 * 捏合缩放：两根指针的距离直接映射到缩放比。
 * 用 pointerId 区分主次指针，只认「第二根按下时建立的那一对」。
 */
export function PinchZoom() {
  const reduce = useReducedMotion();
  const [scale, setScale] = useState(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const baseDistance = useRef(0);
  const baseScale = useRef(1);

  return (
    <div
      className="flex h-full w-full touch-none items-center justify-center overflow-hidden bg-surface-fill"
      data-lab="pinch"
      onPointerDown={(event) => {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          baseDistance.current = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          baseScale.current = scale;
        }
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2 && !reduce) {
          const [a, b] = [...pointers.current.values()];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          setScale(Math.min(3, Math.max(0.5, baseScale.current * (distance / baseDistance.current))));
        }
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
      }}
    >
      <motion.div
        className="flex h-20 w-28 items-center justify-center rounded-card border border-line-split bg-surface text-caption text-ink-secondary"
        animate={{ scale }}
        transition={{ duration: reduce ? 0 : 0.05 }}
      >
        双指捏合
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- 甩动惯性 */

/** 甩动惯性：自己算速度与摩擦，比 framer 的 dragMomentum 更能体现"甩"的力度 */
export function FlingCard() {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [speed, setSpeed] = useState(0);

  const onDragEnd = (_: unknown, info: { offset: { x: number; y: number }; velocity: { x: number; y: number } }) => {
    const vx = info.velocity.x;
    const vy = info.velocity.y;
    const distance = Math.hypot(info.offset.x, info.offset.y);
    if (reduce || distance < 8) return;
    setSpeed(Math.round(Math.hypot(vx, vy)));
    // 摩擦系数 0.92：每次帧速度衰减 8%，停下大约半秒
    let cx = x.get();
    let cy = y.get();
    let sx = vx;
    let sy = vy;
    const step = () => {
      sx *= 0.92;
      sy *= 0.92;
      cx += sx / 60;
      cy += sy / 60;
      x.set(cx);
      y.set(cy);
      if (Math.hypot(sx, sy) > 30) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="fling">
      <motion.div
        className="flex h-12 w-20 cursor-grab items-center justify-center rounded-card bg-brand-500 text-caption text-white active:cursor-grabbing"
        style={{ x, y }}
        drag={!reduce}
        dragMomentum={false}
        onDragEnd={onDragEnd}
      >
        甩我
      </motion.div>
      <span className="tabular text-[11px] text-ink-tertiary">甩出速度 {speed} px/s</span>
    </div>
  );
}

/* ---------------------------------------------------------------- 边缘回弹光 */

/* ---------------------------------------------------------------- 边缘回弹光 */

/**
 * 边缘回弹光：滚到边界时边缘亮一下。
 * 桌面端没有橡皮筋手感，但"我到底了"这个信息必须给——光晕比弹跳更适合表格。
 */
export function OverscrollGlow() {
  const [edge, setEdge] = useState<"none" | "top" | "bottom">("none");
  const reduce = useReducedMotion();

  return (
    <div
      className="scroll-slim relative h-full w-full overflow-y-auto px-4 py-3"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (reduce) return;
        if (el.scrollTop <= 0) setEdge("top");
        else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) setEdge("bottom");
        else setEdge("none");
      }}
      data-lab="overscroll"
    >
      <motion.span
        className="pointer-events-none absolute inset-x-0 top-0 h-8"
        style={{ background: "linear-gradient(to bottom, rgba(105,217,179,0.28), transparent)" }}
        animate={{ opacity: edge === "top" ? 1 : 0 }}
        transition={{ duration: 0.25 }}
      />
      <motion.span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
        style={{ background: "linear-gradient(to top, rgba(105,217,179,0.28), transparent)" }}
        animate={{ opacity: edge === "bottom" ? 1 : 0 }}
        transition={{ duration: 0.25 }}
      />
      <p className="mb-2 text-caption text-ink-tertiary">滚到顶 / 滚到底看边缘光</p>
      {Array.from({ length: 14 }, (_, i) => (
        <div key={i} className="border-b border-line-split py-1.5 text-caption text-ink-secondary">
          第 {i + 1} 条记录
        </div>
      ))}
    </div>
  );
}

/** 擦除揭示：手指划过的地方擦掉遮罩，像在用橡皮擦开雾玻璃 */
export function ScrubReveal() {
  const reduce = useReducedMotion();
  const [trail, setTrail] = useState<Array<{ x: number; y: number }>>([]);

  const paint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTrail((prev) => [...prev.slice(-24), { x: event.clientX - rect.left, y: event.clientY - rect.top }]);
  };

  return (
    <div
      className="relative h-full w-full cursor-crosshair overflow-hidden"
      onPointerMove={paint}
      onPointerDown={paint}
      data-lab="scrub"
    >
      <div className="absolute inset-0 flex items-center justify-center bg-brand-500 text-caption text-white">
        被盖住的内容
      </div>
      <motion.div
        className="absolute inset-0 bg-[#F0F2F5]"
        animate={{ opacity: trail.length > 6 ? 0 : 1 }}
        transition={{ duration: 0.5 }}
      />
      {trail.map((point, index) => (
        <span
          key={index}
          className="pointer-events-none absolute rounded-full bg-[#F0F2F5]"
          style={{
            left: point.x - 18,
            top: point.y - 18,
            width: 36,
            height: 36,
            opacity: 0.9 - index * 0.02,
          }}
        />
      ))}
      <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-ink-tertiary">
        拖动擦开
      </p>
    </div>
  );
}
