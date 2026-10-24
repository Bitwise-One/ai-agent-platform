/**
 * 文字与数据组：逐字 3D 翻入、里程表数字、流式打字。
 *
 * 这一组处理的是"内容本身在变"的动效。共同原则：
 * 数字和文字的变化必须**可追踪**——用户的视线要能跟着某个字/某一位数走，
 * 所以逐字而不是逐块，逐位而不是整体淡入淡出。
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { spring } from "../../lib/motion";
// 逐字翻入与里程表已提升为全站原语（指标卡、标题都要用），这里直接复用，避免两份实现漂移
import { Odometer, SplitText } from "../motion";

/* ---------------------------------------------------------------- 逐字翻入 */

export function CharRevealDemo() {
  const [round, setRound] = useState(0);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5" data-lab="split">
      <div key={round} className="px-5 text-center">
        <SplitText text="多智能体编排" className="text-title text-ink-primary" stagger={0.06} />
        <div className="mt-2">
          <SplitText
            text="每一个字都从纸面立起来"
            className="text-caption text-ink-tertiary"
            delay={0.28}
            stagger={0.028}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setRound((n) => n + 1)}
        className="rounded-control border border-line-base bg-surface px-3 py-1.5 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        重放
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 里程表 */

export function OdometerDemo() {
  const [value, setValue] = useState(1286);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5" data-lab="odometer">
      <div className="flex items-baseline gap-2">
        <Odometer value={value} className="text-ink-primary" />
        <span className="text-caption text-ink-tertiary">次会话</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setValue((v) => v + 1)}
          className="rounded-control border border-line-base bg-surface px-3 py-1.5 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          +1
        </button>
        <button
          type="button"
          onClick={() => setValue((v) => v + 137)}
          className="rounded-control border border-line-base bg-surface px-3 py-1.5 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          +137
        </button>
        <button
          type="button"
          onClick={() => setValue(Math.floor(Math.random() * 9000) + 1000)}
          className="rounded-control border border-line-base bg-surface px-3 py-1.5 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          随机
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 流式打字 */

const STREAM_TEXT =
  "路由命中「退款」意图，已加载售后政策知识库，正在生成答复：订单在签收后 7 天内可无理由退货。";

/**
 * 流式打字 + 声纹：打字时常驻光标闪动、声纹跳动；打完后声纹落回静止。
 * 声纹不是为了装饰——它把"模型还在算"这件不可见的事，变成可感知的节拍。
 */
export function StreamTyper() {
  const [count, setCount] = useState(0);
  const [round, setRound] = useState(0);
  const typing = count < STREAM_TEXT.length;

  useEffect(() => {
    if (!typing) return;
    const timer = window.setTimeout(() => setCount((c) => c + 1), 42);
    return () => window.clearTimeout(timer);
  }, [count, typing]);

  return (
    <div className="flex h-full w-full flex-col justify-center gap-4 px-5" data-lab="stream">
      <div className="min-h-[76px] rounded-control bg-surface px-3.5 py-3">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          <span className="text-[11px] text-ink-tertiary">售后助手</span>
        </div>
        <p className="mt-1.5 text-caption leading-6 text-ink-secondary">
          {STREAM_TEXT.slice(0, count)}
          {typing && (
            <motion.span
              className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-brand-500"
              animate={{ opacity: [1, 0.1, 1] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex h-7 items-end gap-[3px]">
          {Array.from({ length: 9 }, (_, i) => (
            // 声纹是常驻循环：交给 CSS（.anim-wave），delay 逐根错开形成从左到右的波；
            // 打完字就摘掉动画类、停在静止高度，避免"还在算"的错觉。
            <span
              key={`${round}-${i}`}
              className={"w-[3px] rounded-full bg-brand-400 " + (typing ? "anim-wave" : "")}
              style={{
                height: 26,
                transformOrigin: "bottom",
                animationDelay: `${i * 0.06}s`,
                transform: typing ? undefined : "scaleY(0.18)",
              }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setCount(0);
            setRound((r) => r + 1);
          }}
          className="rounded-control border border-line-base bg-surface px-3 py-1.5 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
        >
          重新生成
        </button>
      </div>
    </div>
  );
}

/** 供其它页面复用的「数字 + 单位」组合 */
export function StatOdometer({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <motion.span layout transition={spring}>
        <Odometer value={value} fontSize={28} className="text-ink-primary" />
      </motion.span>
      <span className="text-caption text-ink-tertiary">{unit}</span>
    </span>
  );
}
