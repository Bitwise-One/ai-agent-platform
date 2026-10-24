/**
 * 文字组：内容本身在变，所以变化必须「可追踪」。
 *
 * 判据：逐字而不是逐块、逐位而不是整体。用户的眼睛要能跟着
 * 某个字/某一位走完这次变化，否则动效只是噪音。
 */

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 乱码解码 */

const GLYPHS = "01#%$&@*+=<>[]{}ABCDEF";
const TARGET = "路由决策已完成";

/** 乱码解码：每位从随机字符逐个"锁"到目标字符，顺序从左到右 */
export function ScrambleText() {
  const reduce = useReducedMotion();
  const [text, setText] = useState(TARGET);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    const total = 26;
    const timer = window.setInterval(() => {
      frame += 1;
      setText(
        TARGET.split("")
          .map((char, index) => {
            // 每一位的"锁定帧"不同，形成从左往右依次落定的扫描感
            if (index * 2 < frame) return char;
            if (char === " ") return " ";
            return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          })
          .join(""),
      );
      if (frame >= total) {
        window.clearInterval(timer);
        setText(TARGET);
      }
    }, 55);
    return () => window.clearInterval(timer);
  }, [reduce, round]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="scramble">
      <span className="font-mono text-subtitle text-ink-primary">{text}</span>
      <button
        type="button"
        onClick={() => setRound((n) => n + 1)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        再解码一次
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 打字机故障 */

/** 打字机 + 故障：打字时偶尔抽动一下（clip-path 切条），像信号不稳 */
export function GlitchTyper() {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(0);
  const line = "POST /v1/chat/completions → 200 OK";
  const done = count >= line.length;

  useEffect(() => {
    if (done) return;
    const timer = window.setTimeout(() => setCount((c) => c + 1), 78);
    return () => window.clearTimeout(timer);
  }, [count, done]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="glitch">
      <span className={"font-mono text-caption text-ink-primary " + (!done && !reduce ? "anim-glitch" : "")}>
        {line.slice(0, count)}
        {!done && <span className="anim-blink ml-0.5 inline-block h-3 w-[2px] translate-y-[2px] bg-brand-500" />}
      </span>
      <button
        type="button"
        onClick={() => setCount(0)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        重打
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 跑马灯 */

/** 跑马灯：内容复制两份，位移 50% 后无缝接上——少一份就会出现空档 */
export function Marquee() {
  const items = ["路由策略 keyword", "RAG top_k 5", "温度 0.3", "最大 2048 tokens", "流式 SSE"];

  return (
    <div className="flex h-full w-full items-center overflow-hidden" data-lab="marquee">
      <div className="anim-marquee flex w-max shrink-0 gap-6 whitespace-nowrap">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 gap-6">
            {items.map((item) => (
              <span key={`${copy}-${item}`} className="rounded-sm bg-surface-fill px-2 py-1 text-caption text-ink-secondary">
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 环形计数 */

/** 环形计数：stroke-dashoffset 从整圈缩到目标比例，比"数字跳一下"更有进度感 */
export function CountRing() {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(38);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="ring">
      <div className="relative h-16 w-16">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={radius} fill="none" stroke="#F0F0F0" strokeWidth={6} />
          <motion.circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="#7644A7"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - value / 100) }}
            transition={{ duration: reduce ? 0 : 0.9, ease: EASE }}
          />
        </svg>
        <span className="tabular absolute inset-0 flex items-center justify-center text-body font-medium text-ink-primary">
          {value}%
        </span>
      </div>
      <div className="flex gap-2">
        {[38, 72, 96].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setValue(n)}
            className="rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
          >
            {n}%
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 文字变形 */

/** 文字变形：两个词交叉淡入，各自带模糊与位移，避免"硬切换" */
export function WordMorph() {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const words = ["工作流", "画布", "编排"];

  useEffect(() => {
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % words.length), 2200);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="relative flex h-full w-full items-center justify-center" data-lab="morph">
      {words.map((word, i) => (
        <motion.span
          key={word}
          className="absolute text-title font-semibold text-ink-primary"
          animate={
            reduce
              ? { opacity: i === index ? 1 : 0 }
              : {
                  opacity: i === index ? 1 : 0,
                  y: i === index ? 0 : 10,
                  filter: i === index ? "blur(0px)" : "blur(4px)",
                }
          }
          transition={{ duration: reduce ? 0 : 0.42, ease: EASE }}
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- 单词翻牌 */

/** 单词翻牌：整词绕底边翻 90°，一组词依次落下，比逐字更像"翻牌" */
export function WordFlip() {
  const reduce = useReducedMotion();
  const words = ["路由", "检索", "生成", "审核"];

  return (
    <div className="flex h-full w-full items-center justify-center gap-2" data-lab="wordflip">
      {words.map((word, index) => (
        <motion.span
          key={word}
          className="inline-block origin-bottom rounded-control border border-line-split bg-surface px-2.5 py-1.5 text-caption text-ink-primary"
          style={{ perspective: 480 }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, rotateX: -90 }}
          animate={{ opacity: 1, rotateX: 0 }}
          transition={{ duration: reduce ? 0.2 : 0.6, ease: EASE, delay: reduce ? 0 : index * 0.14 }}
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- 字符波浪 */

/** 字符波浪：每个字一个 animation-delay，正弦波从左走到右 */
export function CharWave() {
  const text = "让每一次反馈都有回响";
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="wave">
      <span className="flex gap-0.5">
        {Array.from(text).map((char, index) => (
          <span
            key={`${char}-${index}`}
            className={"inline-block text-subtitle font-medium text-brand-600 " + (reduce ? "" : "anim-bob-y")}
            style={{ animationDelay: `${index * 0.06}s` }}
          >
            {char}
          </span>
        ))}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 滚动行情 */

/** 滚动行情：竖向无缝循环——内容复制两份，位移 -50% 即回到起点 */
export function QuoteTicker() {
  const rows = ["会话数 1,286", "命中率 87%", "平均耗时 412ms", "Token 18.4k"];
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="ticker">
      <div className="relative h-6 overflow-hidden">
        <div className={"flex flex-col " + (reduce ? "" : "anim-ticker-v")}>
          {[0, 1].map((copy) =>
            rows.map((row) => (
              <span key={`${copy}-${row}`} className="tabular h-6 shrink-0 text-caption text-ink-secondary">
                {row}
              </span>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 逐字消散 */

/** 逐字消散：悬停时每个字向不同方向飘走，离开时归位（stagger 反向） */
export function DisperseText() {
  const reduce = useReducedMotion();
  const [out, setOut] = useState(false);
  const text = "悬停以消散";

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onPointerEnter={() => setOut(true)}
      onPointerLeave={() => setOut(false)}
      data-lab="disperse"
    >
      <span className="flex text-subtitle font-semibold text-ink-primary">
        {Array.from(text).map((char, index) => (
          <motion.span
            key={index}
            className="inline-block"
            animate={
              reduce
                ? {}
                : {
                    x: out ? (index % 2 ? 14 : -14) : 0,
                    y: out ? (index % 3 ? -10 : 10) : 0,
                    opacity: out ? 0 : 1,
                    rotate: out ? (index % 2 ? 18 : -18) : 0,
                  }
            }
            transition={{ duration: reduce ? 0 : 0.5, ease: EASE, delay: reduce ? 0 : index * 0.03 }}
          >
            {char}
          </motion.span>
        ))}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 打字光标 */

/** 打字光标：光标本身也是一个"角色"——它在等，说明系统也在等 */
export function CaretBlink() {
  return (
    <div className="flex h-full w-full items-center justify-center gap-2" data-lab="caret">
      <span className="rounded-control bg-surface-fill px-3 py-1.5 text-caption text-ink-secondary">
        等待输入
      </span>
      <span className="anim-blink inline-block h-4 w-[2px] bg-brand-500" />
    </div>
  );
}
