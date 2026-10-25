/**
 * 动效原语：页面过渡、逐项入场、数字滚动、极光背景、水滴分溅。
 *
 * 为什么单独抽一层而不是各处写 `motion.div`：
 * - 参数（缓动、位移量、时长）必须统一，否则同一产品里会出现「三种弹速」；
 * - `prefers-reduced-motion` 只在这层判断一次，页面里不用反复处理；
 * - 液体类效果（水滴分溅、极光）用的人多、写起来长，收在这里才不会复制粘贴。
 */

import {
  AnimatePresence,
  animate,
  motion,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { EASE, pageVariants } from "../lib/motion";
import { IconSparkle } from "./icons";

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
 *
 * 漂移交给 CSS（.anim-drift）：常驻循环跑在合成线程上，主线程再忙也不掉帧；
 * 三团的 duration 与负 delay 各不相同，看起来像互不相干的光在慢慢挪。
 */
export function AuroraField({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const blobs = useMemo(
    () => [
      { size: 420, color: "rgba(66,202,157,0.18)", x: "-12%", y: "-30%", dur: 22, delay: 0 },
      { size: 360, color: "rgba(74,161,145,0.14)", x: "58%", y: "-10%", dur: 26, delay: -8 },
      { size: 300, color: "rgba(207,177,111,0.09)", x: "25%", y: "45%", dur: 19, delay: -14 },
    ],
    [],
  );

  return (
    <div className={"pointer-events-none absolute inset-0 overflow-hidden " + className} aria-hidden="true">
      {blobs.map((blob, index) => (
        <span
          key={index}
          // 不用 blur 滤镜：radial-gradient 本身边缘就是渐隐的，
          // 再叠一层 filter:blur 会让"滤镜层 + 位移动画"在部分渲染路径下露出硬边方框。
          className={"absolute rounded-full " + (reduce ? "" : "anim-drift")}
          style={{
            width: blob.size,
            height: blob.size,
            left: blob.x,
            top: blob.y,
            background: `radial-gradient(circle at 50% 50%, ${blob.color}, transparent 68%)`,
            animationDuration: `${blob.dur}s`,
            animationDelay: `${blob.delay}s`,
          }}
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
      ? { ring: "#68E1A6", core: "#B6F3CE", drop: "#7EE7AE" }
      : { ring: "#4CCCA3", core: "#A5F1D6", drop: "#61D9B4" };

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
      style={{ backgroundColor: "#74E0BD" }}
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

/* ================================================================ 条件显隐 */

/**
 * 条件块显隐：高度与透明度一起动，退场时先收起来再卸载。
 *
 * 用在哪：检查器卡片、随开关出现的表单字段——这些块「时有时无」，
 * 直接条件渲染会「闪」一下，高度动画把出现/消失本身变成可见的过程。
 *
 * 注意：内容必须是块级且自带左右尺寸（高度动画只接管垂直方向），
 * 所以调用方传 className 控制宽度，组件内部只加 overflow-hidden。
 */
export function Reveal({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className={className}
          style={{ overflow: "hidden" }}
          initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.26, ease: EASE }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ================================================================ 变化高亮 */

/**
 * 变化高亮：`value` 发生变化时，整块扫过一次品牌色。
 *
 * 用在哪：探测结果落表、trace 面板的耗时/Token 刷新——数字本身会变，
 * 但「它刚变了」这件事不标记出来，用户扫读时会漏掉。
 * 不改布局、不加边框，只借一层会散掉的淡色，所以可以放心裹在表格单元格外。
 */
export function Flash({
  value,
  children,
  className,
}: {
  value: unknown;
  children: ReactNode;
  className?: string;
}) {
  const active = useFlash(value);
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={false}
      animate={
        active && !reduce
          ? { backgroundColor: ["rgba(66,202,157,0.2)", "rgba(66,202,157,0)"] }
          : { backgroundColor: "rgba(66,202,157,0)" }
      }
      transition={{ duration: 0.6, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* ================================================================ 内容切换 */

/**
 * 内容切换：同一位置换内容时，旧的淡出、新的淡入，两者不重叠。
 *
 * 用在哪：画布的连线提示、trace 面板的 run_id——原地替换 DOM 会「跳」一下，
 * 淡出淡入把「换了」这个事件本身变得可感知。id 变才重放，内容不变不动画。
 */
export function FadeSwap({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        className={className}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* ================================================================ 小件弹入 */

/** 小件弹入：比 listItem 多一层缩放，用于标签、徽标这类「该被看见」的小元素 */
export const popItem: Variants = {
  initial: { opacity: 0, scale: 0.82 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 520, damping: 24, mass: 0.5 },
  },
};

/** 逐项浮入：检查器里的列表项（连线、版本、校验问题）统一用它，比整卡淡入更容易定位 */
export const riseItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

/* ================================================================ 点击波纹 */

export interface RippleItem {
  id: number;
  x: number;
  y: number;
  size: number;
}

/**
 * 点击波纹：按下点作为圆心向外扩散一圈半透明水膜。
 *
 * 为什么要做到「按下点」而不是元素中心：手指/鼠标落在哪里，反馈就该从哪里长出来，
 * 从中心扩散会让人觉得按钮在「自己闪」而不是「被我按了」。
 *
 * 用法：容器上加 `relative overflow-hidden`，把 `onPointerDown={spawn}` 挂上去，
 * 内部渲染 `<RippleLayer items={items} />`。波纹颜色取 `currentColor`，
 * 主按钮（白字）与次按钮（深字）自动适配，不需要传色。
 */
export function useRipple() {
  const [items, setItems] = useState<RippleItem[]>([]);
  const seed = useRef(0);

  const spawn = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // 直径取长边的 2.2 倍：波纹要「漫过」整个按钮再消失，否则像个小圆点
    const size = Math.max(rect.width, rect.height) * 2.2;
    const item: RippleItem = {
      id: ++seed.current,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      size,
    };
    // 只保留最近 4 个：连点时不至于堆出几十个 span
    setItems((prev) => [...prev.slice(-3), item]);
    window.setTimeout(() => setItems((prev) => prev.filter((one) => one.id !== item.id)), 640);
  }, []);

  return { items, spawn };
}

export function RippleLayer({ items, className }: { items: RippleItem[]; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return null;

  return (
    <span
      className={"pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] " + (className ?? "")}
      aria-hidden="true"
    >
      <AnimatePresence>
        {items.map((item) => (
          <motion.span
            key={item.id}
            data-ripple={item.id}
            className="absolute rounded-full bg-current"
            style={{
              left: item.x - item.size / 2,
              top: item.y - item.size / 2,
              width: item.size,
              height: item.size,
            }}
            initial={{ scale: 0, opacity: 0.24 }}
            animate={{ scale: 1, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.62, ease: EASE }}
          />
        ))}
      </AnimatePresence>
    </span>
  );
}

/* ================================================================ 加载环 */

/**
 * 加载环：一段缺口圆弧匀速旋转，比 `animate-spin` 的整圈边框更「有指向」。
 * 常驻循环交给 CSS（内联 animation），不占 framer 的帧循环。
 */
export function LoadingRing({
  size = 18,
  thickness = 2,
  className = "",
}: {
  size?: number;
  thickness?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const center = size / 2;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={reduce ? undefined : { animation: "lab-spin 0.85s linear infinite" }}
      aria-hidden="true"
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={thickness}
        opacity={0.18}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={`${circumference * 0.32} ${circumference}`}
        opacity={0.95}
      />
    </svg>
  );
}

/* ================================================================ 错误抖动 */

/**
 * 错误抖动：横向衰减摆动，模拟「撞了一下墙」。
 *
 * 只在「出错了」这一件事上用它——抖动是全站最强的注意力抢夺手段之一，
 * 用两次以上用户就会开始烦。位移控制在 7px 内，不破坏布局感知。
 */
export function ShakeBox({
  trigger,
  children,
  className,
}: {
  trigger: unknown;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const controls = useAnimationControls();

  useEffect(() => {
    if (reduce) return;
    void controls.start({
      x: [0, -7, 6, -5, 4, -2, 0],
      transition: { duration: 0.44, ease: "easeInOut" },
    });
  }, [controls, reduce, trigger]);

  return (
    <motion.div className={className} animate={controls}>
      {children}
    </motion.div>
  );
}

/* ================================================================ 滚动进度 */

/**
 * 滚动进度：内容区顶部一条 2px 的进度线。
 *
 * 控制台用的是「内层滚动容器」而不是 window 滚动，所以必须把容器 ref 传进来
 * （`useScroll({ container })`），否则进度永远是 0——这是最容易踩的坑。
 */
export function ScrollProgress({ target }: { target: RefObject<HTMLElement> }) {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ container: target });
  const scaleX = useSpring(scrollYProgress, { stiffness: 180, damping: 30, mass: 0.4 });
  const [scrollable, setScrollable] = useState(false);

  /**
   * 只在「真的能滚」时显示。
   *
   * 内层容器没有溢出时，滚动进度会停在 1（framer 认为已在终点），
   * 结果就是短页面上顶一条满格进度线——像加载条卡死，比没有还糟。
   * 所以要盯住容器与首个子元素的高度变化（表格加载完之后才可能变高）。
   */
  useEffect(() => {
    const el = target.current;
    if (!el) return;

    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 4);
    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [target]);

  if (reduce || !scrollable) return null;

  return (
    <motion.div
      data-scroll-progress="1"
      className="pointer-events-none absolute left-0 top-0 z-30 h-[2px] w-full origin-left bg-gradient-to-r from-brand-300 via-brand-500 to-brand-400"
      style={{ scaleX }}
      aria-hidden="true"
    />
  );
}

/* ================================================================ 空态插画 */

const ART_TONE = {
  brand: { core: "#72DEBB", soft: "rgba(66,202,157,0.14)", ring: "rgba(100,227,185,0.3)" },
  success: { core: "#68E1A6", soft: "rgba(88,210,145,0.14)", ring: "rgba(104,225,166,0.3)" },
  error: { core: "#FF8F99", soft: "rgba(255,105,120,0.12)", ring: "rgba(255,126,139,0.26)" },
} as const;

/**
 * 空态插画：虚线轨道缓慢自转 + 两颗卫星按不同周期绕行 + 中心图标悬浮。
 *
 * 空状态最怕「死」——一块空白加一行字，用户会怀疑是不是没加载出来。
 * 让它保持极慢的自转，就能传达「这里是有生命的，只是在等你」。
 * 三条轨道的周期是 9s / 14s / 22s，互质，所以几乎不会同时回到起点。
 */
export function EmptyArt({
  tone = "brand",
  size = 96,
  className,
}: {
  tone?: keyof typeof ART_TONE;
  size?: number;
  className?: string;
}) {
  const palette = ART_TONE[tone];

  return (
    <div
      className={"relative shrink-0 " + (className ?? "")}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* 底光：一团会形变的柔光，给插画一点体积感 */}
      <span
        className="anim-blob absolute inset-[18%] rounded-full"
        style={{ background: `radial-gradient(circle at 50% 45%, ${palette.soft}, transparent 70%)` }}
      />

      {/* 外轨道：虚线自转，是整个插画的「基频」 */}
      <span
        className="absolute inset-0 rounded-full border border-dashed"
        style={{ borderColor: palette.ring, animation: "lab-spin 22s linear infinite" }}
      />

      {/* 内圈实线：反向慢转，形成视差 */}
      <span
        className="absolute inset-[22%] rounded-full border"
        style={{ borderColor: palette.ring, animation: "lab-spin 14s linear infinite reverse" }}
      />

      {/* 卫星 A：容器转、点不动，看起来就是点在绕圈 */}
      <span className="absolute inset-0" style={{ animation: "lab-spin 9s linear infinite" }}>
        <span
          className="absolute h-1.5 w-1.5 rounded-full"
          style={{ left: "calc(50% - 3px)", top: -3, background: palette.core }}
        />
      </span>

      {/* 卫星 B：相位错开 180°，半径更小 */}
      <span className="absolute inset-[22%]" style={{ animation: "lab-spin 14s linear infinite" }}>
        <span
          className="absolute h-1 w-1 rounded-full"
          style={{ left: "calc(50% - 2px)", top: -2, background: palette.core, opacity: 0.65 }}
        />
      </span>

      {/* 中心图标：上下悬浮 2px，幅度再大就会显得轻浮 */}
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{ color: palette.core, animation: "lab-float 4.6s ease-in-out infinite" }}
      >
        <IconSparkle size={Math.round(size * 0.24)} />
      </span>
    </div>
  );
}

/* ================================================================ 折线图 */

const SPARK_TONE = {
  brand: { line: "#68D9B1", area: "#37AE8B" },
  success: { line: "#68E1A6", area: "#38B679" },
  error: { line: "#FF8F99", area: "#FFB0A7" },
} as const;

/** 用 Catmull-Rom 转三次贝塞尔：比折线柔和，又不像手绘曲线那样过冲 */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  const round = (n: number) => Math.round(n * 100) / 100;
  if (points.length === 1) return `M ${round(points[0].x)} ${round(points[0].y)}`;

  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const tension = 0.16;
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2.x)} ${round(p2.y)}`;
  }
  return d;
}

/**
 * 折线：描边自绘（pathLength 从 0 到 1），面积随描边淡入，末点最后落下。
 *
 * 为什么用 pathLength 而不是 clip-path 擦除：pathLength 是 SVG 原生能力，
 * 不同长度的路径都能自动归一化，不需要按宽度算 mask 尺寸。
 */
export function Sparkline({
  data,
  height = 48,
  width = 180,
  tone = "brand",
  showArea = true,
  showDot = true,
  delay = 0,
  className,
  strokeWidth = 2,
}: {
  data: number[];
  height?: number;
  width?: number;
  tone?: keyof typeof SPARK_TONE;
  showArea?: boolean;
  showDot?: boolean;
  delay?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const reduce = useReducedMotion();
  const gradientId = useId().replace(/:/g, "");
  const palette = SPARK_TONE[tone];

  const { line, area, last } = useMemo(() => {
    if (data.length === 0) return { line: "", area: "", last: { x: 0, y: 0 } };
    const pad = strokeWidth + 1;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const stepX = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;

    const points = data.map((value, index) => ({
      x: pad + index * stepX,
      // y 轴翻转：数值越大，屏幕坐标越小
      y: pad + (1 - (value - min) / span) * (height - pad * 2),
    }));

    const path = smoothPath(points);
    const tail = points[points.length - 1];
    return {
      line: path,
      area: `${path} L ${tail.x} ${height} L ${points[0].x} ${height} Z`,
      last: tail,
    };
  }, [data, height, strokeWidth, width]);

  if (data.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height }}
      role="img"
      aria-label={`趋势：${data.join("、")}`}
    >
      <defs>
        <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.area} stopOpacity={0.28} />
          <stop offset="100%" stopColor={palette.area} stopOpacity={0} />
        </linearGradient>
      </defs>

      {showArea && (
        <motion.path
          d={area}
          fill={`url(#spark-${gradientId})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE, delay: reduce ? 0 : delay + 0.35 }}
        />
      )}

      <motion.path
        d={line}
        fill="none"
        stroke={palette.line}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={reduce ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0.4 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: reduce ? 0 : 1.05, ease: EASE, delay: reduce ? 0 : delay }}
      />

      {showDot && (
        <motion.circle
          cx={last.x}
          cy={last.y}
          r={3}
          fill="#FFFFFF"
          stroke={palette.line}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          initial={reduce ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.34, ease: EASE, delay: reduce ? 0 : delay + 1.0 }}
          style={{ transformOrigin: `${last.x}px ${last.y}px` }}
        />
      )}
    </svg>
  );
}

/* ================================================================ 逐字翻入 */

/**
 * 逐字 3D 翻入：每个字绕底边向后翻 92° 再落下。
 *
 * 必须给父层 perspective，否则 rotateX 只是把字压扁，没有「翻」的体感。
 * 只用于标题级文字（≤ 12 字）；正文逐字入场会拖慢阅读。
 */
export function SplitText({
  text,
  className = "",
  delay = 0,
  stagger = 0.045,
  style,
}: {
  text: string;
  className?: string;
  delay?: number;
  stagger?: number;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();

  return (
    <span className={className} style={{ display: "inline-block", perspective: 640, ...style }}>
      {Array.from(text).map((char, index) => (
        <motion.span
          key={`${char}-${index}`}
          className="inline-block"
          style={{ transformOrigin: "50% 100%", whiteSpace: "pre" }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, rotateX: -92, y: 14 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, rotateX: 0, y: 0 }}
          transition={{
            duration: reduce ? 0.2 : 0.62,
            ease: EASE,
            delay: reduce ? 0 : delay + index * stagger,
          }}
        >
          {char}
        </motion.span>
      ))}
    </span>
  );
}

/* ================================================================ 里程表 */

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * 里程表：每一位是一条 0–9 的竖条，改数字就是把它整体上下平移。
 *
 * 相比 CountUp（整个数字跳变），里程表能让眼睛看清「是哪一位在进位」——
 * 指标卡用它，用户才会注意到「千位从 1 变成 2」这种真正重要的变化。
 */
export function Odometer({
  value,
  fontSize = 34,
  className = "",
  enter = false,
}: {
  value: number;
  fontSize?: number;
  className?: string;
  /** 首次出现时从 0 滚上来（指标卡用）；列表里的数字保持从当前值开始，不要每次都重滚 */
  enter?: boolean;
}) {
  const reduce = useReducedMotion();
  const digits = String(Math.max(0, Math.round(value))).split("");
  // 数字宽度取 0.62em：等宽数字的实际字宽就在这个附近，太宽会散
  const cell = Math.round(fontSize * 0.62);

  return (
    <span
      className={"inline-flex tabular " + className}
      style={{ fontSize, lineHeight: `${fontSize}px` }}
      aria-label={String(value)}
    >
      {digits.map((digit, index) => (
        <span
          key={`${index}-${digits.length}`}
          className="relative inline-block overflow-hidden"
          style={{ height: fontSize, width: cell }}
          aria-hidden="true"
        >
          <motion.span
            className="absolute left-0 top-0 flex w-full flex-col items-center"
            initial={enter && !reduce ? { y: 0 } : false}
            animate={{ y: -Number(digit) * fontSize }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 260, damping: 30, mass: 0.8 }
            }
          >
            {DIGITS.map((n) => (
              <span
                key={n}
                className="block w-full text-center"
                style={{ height: fontSize, lineHeight: `${fontSize}px` }}
              >
                {n}
              </span>
            ))}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
