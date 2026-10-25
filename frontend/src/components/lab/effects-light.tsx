/**
 * 光影组：3D 倾斜、流光描边、滚动景深。
 *
 * 这一组的目标不是"动"，而是"立体"——让人相信界面有厚度、有光源。
 * 关键细节：倾斜必须带视角（perspective），光必须跟着手走（否则像贴纸），
 * 景深必须由滚动进度驱动（而不是固定速度的视差，那种一看就假）。
 */

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { useRef, type PointerEvent as RPointerEvent } from "react";

/* ---------------------------------------------------------------- 3D 倾斜 */

export function TiltCard() {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);

  const rotateX = useSpring(useTransform(py, [0, 1], [11, -11]), {
    stiffness: 200,
    damping: 22,
  });
  const rotateY = useSpring(useTransform(px, [0, 1], [-14, 14]), {
    stiffness: 200,
    damping: 22,
  });

  const gx = useTransform(px, (v) => v * 100);
  const gy = useTransform(py, (v) => v * 100);
  // 高光是"贴在卡片表面"的一团白，所以用 radial-gradient 而不是 overlay 白色半透明
  const glare = useMotionTemplate`radial-gradient(220px circle at ${gx}% ${gy}%, rgba(255,255,255,0.9), rgba(255,255,255,0) 62%)`;

  const onMove = (event: RPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width);
    py.set((event.clientY - rect.top) / rect.height);
  };

  const reset = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      data-lab="tilt"
      style={{ perspective: 900 }}
    >
      <motion.div
        onPointerMove={onMove}
        onPointerLeave={reset}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="relative h-[136px] w-[214px] rounded-card border border-line-base bg-surface shadow-popup"
      >
        {/* 不同 Z 轴深度：倾斜时才会看出层次，全在同一平面就只是"歪了一下" */}
        <div
          className="flex h-full flex-col justify-between px-4 py-3.5"
          style={{ transform: "translateZ(28px)" }}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-control bg-brand-50 text-brand-600">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="7" width="16" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 3v4M9 13h.01M15 13h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <div className="text-caption text-ink-primary">售后助手</div>
              <div className="text-[10px] text-ink-tertiary">gpt-4o-mini</div>
            </div>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <div className="tabular text-title text-ink-primary">98.2%</div>
              <div className="text-[10px] text-ink-tertiary">一次解决率</div>
            </div>
            <div className="flex h-7 items-end gap-[3px]">
              {[40, 62, 48, 78, 92].map((h, i) => (
                <motion.span
                  key={i}
                  className="w-[5px] rounded-sm bg-brand-300"
                  initial={{ height: 4 }}
                  whileInView={{ height: h * 0.28 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 + i * 0.06, duration: 0.5 }}
                />
              ))}
            </div>
          </div>
        </div>

        <motion.span
          style={{ background: glare, transform: "translateZ(30px)" }}
          className="pointer-events-none absolute inset-0 rounded-card opacity-45 mix-blend-overlay"
          aria-hidden="true"
        />
        <span className="pointer-events-none absolute inset-0 rounded-card ring-1 ring-inset ring-white/40" />
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------- 流光描边 */

/**
 * 描边流光：一圈 conic-gradient 在 1px 的"边框槽"里转。
 * 做法是外层 overflow-hidden，内层白色面板 inset 1px 盖住中间——
 * 比 mask-composite 兼容性好，也比 box-shadow 动画便宜。
 */
export function ShimmerBorder() {
  const panel = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(-200);
  const my = useMotionValue(-200);
  const spot = useMotionTemplate`radial-gradient(160px circle at ${mx}px ${my}px, rgba(105,217,179,0.10), transparent 70%)`;

  const onMove = (event: RPointerEvent<HTMLDivElement>) => {
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    mx.set(event.clientX - rect.left);
    my.set(event.clientY - rect.top);
  };

  return (
    <div className="flex h-full w-full items-center justify-center px-4">
      <div
        ref={panel}
        onPointerMove={onMove}
        onPointerLeave={() => {
          mx.set(-200);
          my.set(-200);
        }}
        data-lab="shimmer"
        className="relative w-full max-w-[240px] overflow-hidden rounded-card p-[1px]"
      >
        <div
          className="anim-spin-slow absolute"
          style={{
            inset: "-60%",
            background:
              "conic-gradient(from 0deg, transparent 0deg, #B7F3E2 30deg, #0D7665 55deg, #39B69A 75deg, transparent 130deg, transparent 360deg)",
          }}
          aria-hidden="true"
        />

        <div className="relative rounded-[7px] bg-surface px-4 py-4">
          <motion.div
            style={{ background: spot }}
            className="pointer-events-none absolute inset-0 rounded-[7px]"
            aria-hidden="true"
          />
          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="text-caption text-ink-primary">工作流版本</span>
              <span className="rounded-sm bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-600">
                v3 生效中
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-ink-tertiary">
              鼠标移进来，边框的光会继续走，面板里还有一团跟着光标的聚光。
            </p>
            <div className="mt-2.5 flex gap-1.5">
              {["规则路由", "RAG 开", "3 Agent"].map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm bg-surface-fill px-1.5 py-0.5 text-[10px] text-ink-tertiary"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 滚动景深 */

const DEPTH_ROWS = [
  { title: "会话摘要", meta: "conversation · 1.2k", opacity: 0.46 },
  { title: "知识库检索片段", meta: "rag · top_k=4", opacity: 0.62 },
  { title: "Agent 执行轨迹", meta: "trace · 12 步", opacity: 0.78 },
  { title: "意图识别结果", meta: "route · rule", opacity: 0.9 },
  { title: "人工介入记录", meta: "hitl · 1", opacity: 1 },
];

/**
 * 景深：越"远"的层移动越慢、越淡、越虚。
 * 用容器自身的 scrollYProgress 驱动，而不是监听 window——
 * 控制台的内容区是内部滚动，监 window 永远不动。
 */
export function ScrollDepth() {
  const box = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container: box });

  // 每层给不同的行程：靠前的层走得少，靠后的层走得多，视觉上就"叠"起来了。
  // 逐条写而不是在 map 里调 hook——hook 数量必须是静态的，靠模块常量"碰巧稳定"不算可靠。
  const y0 = useTransform(scrollYProgress, [0, 1], [10, -8]);
  const y1 = useTransform(scrollYProgress, [0, 1], [20, -17]);
  const y2 = useTransform(scrollYProgress, [0, 1], [30, -26]);
  const y3 = useTransform(scrollYProgress, [0, 1], [40, -35]);
  const y4 = useTransform(scrollYProgress, [0, 1], [50, -44]);
  const ys = [y0, y1, y2, y3, y4];
  // 上下渐隐遮罩：位移会让行贴着容器边缘走，没有遮罩就是"被刀切了一半"
  const fade =
    "linear-gradient(to bottom, transparent 0%, #000 11%, #000 89%, transparent 100%)";

  return (
    <div className="relative h-full w-full">
      <div
        ref={box}
        data-lab="depth"
        className="scroll-slim h-full overflow-y-auto px-5 py-4"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      >
        <div className="space-y-3 pb-24">
          {DEPTH_ROWS.map((row, index) => (
            <motion.div
              key={row.title}
              style={{ y: ys[index], opacity: row.opacity }}
              className="rounded-card border border-line-split bg-surface px-3.5 py-3 shadow-card"
            >
              <div className="flex items-center justify-between">
                <span className="text-caption text-ink-primary">{row.title}</span>
                <span className="font-mono text-[10px] text-ink-tertiary">{row.meta}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                <span className="block h-1.5 w-4/5 rounded-full bg-surface-fill" />
                <span className="block h-1.5 w-3/5 rounded-full bg-surface-fill" />
              </div>
            </motion.div>
          ))}

          {/* 留出滚动余量，让"越远越慢"这件事真的能看出来 */}
          <div className="h-28" />
        </div>
      </div>

      {/* 不再额外放"滚动我"徽标：它会压住首行的元信息，
          而卡片说明里已经写清楚这是滚动驱动的景深 */}
    </div>
  );
}
