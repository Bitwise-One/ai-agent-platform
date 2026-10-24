/**
 * 节奏组：把"时间"变成可见的节拍。
 *
 * 这一组的主语是周期。所有效果都由周期驱动（BPM、秒、帧），
 * 且周期之间要么严格同步（均衡器）、要么彻底错开（声纹）——
 * 半同步是最难看的，像两个人在抢拍。
 */

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 声纹 */

/** 声纹：九根柱子错峰跳动，height 用 scaleY 保证 GPU 合成 */
export function SoundWave() {
  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="soundwave">
      <div className="flex h-14 items-end gap-[3px]">
        {Array.from({ length: 12 }, (_, i) => (
          <span
            key={i}
            className="anim-wave w-[3px] rounded-full bg-brand-400"
            style={{ height: 52, transformOrigin: "bottom", animationDelay: `${i * 0.07}s` }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 均衡器 */

/** 均衡器：低频长、高频短，延迟也按频段分组——像真的在分频 */
export function Equalizer() {
  const bands = [
    { h: 52, delay: 0 },
    { h: 46, delay: 0.05 },
    { h: 38, delay: 0.1 },
    { h: 30, delay: 0.14 },
    { h: 22, delay: 0.18 },
    { h: 16, delay: 0.22 },
    { h: 12, delay: 0.26 },
  ];

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="eq">
      <div className="flex h-16 items-end gap-1.5">
        {bands.map((band, index) => (
          <span
            key={index}
            className="anim-wave w-2.5 rounded-t-sm"
            style={{
              height: band.h,
              transformOrigin: "bottom",
              animationDelay: `${band.delay}s`,
              animationDuration: `${0.9 + index * 0.12}s`,
              background: "linear-gradient(to top, #7644A7, #B995DC)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 节拍脉冲 */

/** 节拍脉冲：每秒两拍，第一下重、第二下轻（重音在前才是鼓点） */
export function BeatPulse() {
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="beat">
      <span
        className={
          "flex h-16 w-16 items-center justify-center rounded-full bg-brand-500 text-caption text-white " +
          (reduce ? "" : "anim-beat")
        }
      >
        120 BPM
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 声纳 */

/** 声纳：两层环错开 1.4s，形成"一圈圈传出去"的后浪推前浪 */
export function SonarPulse() {
  const reduce = useReducedMotion();

  return (
    <div className="relative flex h-full w-full items-center justify-center" data-lab="sonar">
      <span className="h-3 w-3 rounded-full bg-brand-500" />
      {!reduce && (
        <>
          <span className="anim-sonar absolute h-16 w-16 rounded-full border border-brand-400" />
          <span className="anim-sonar anim-sonar-2 absolute h-16 w-16 rounded-full border border-brand-400" />
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 雷达扫描 */

/** 雷达扫描：conic 扇形旋转，上面的光点按自己的周期闪烁 */
export function RadarSweep() {
  const reduce = useReducedMotion();

  return (
    <div className="relative flex h-full w-full items-center justify-center" data-lab="radar">
      <span className="relative h-32 w-32 rounded-full border border-brand-200 bg-brand-50/40">
        {[0.35, 0.7].map((r) => (
          <span
            key={r}
            className="absolute rounded-full border border-brand-200"
            style={{ inset: `${(1 - r) * 50}%` }}
          />
        ))}
        <span
          className="anim-orbit absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(118,68,167,0.42) 0deg 26deg, transparent 26deg 360deg)",
            maskImage: "radial-gradient(circle, #000 0%, #000 100%)",
            WebkitMaskImage: "radial-gradient(circle, #000 0%, #000 100%)",
          }}
        />
        {!reduce && (
          <>
            <span className="anim-pulse-fast absolute left-[28%] top-[34%] h-1.5 w-1.5 rounded-full bg-brand-600" />
            <span
              className="anim-pulse-fast absolute right-[26%] bottom-[28%] h-1.5 w-1.5 rounded-full bg-brand-600"
              style={{ animationDelay: "0.5s" }}
            />
          </>
        )}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 心跳 */

/** 心跳：双跳（咚-哒）比单跳更像心脏，关键是第二下必须比第一下弱 */
export function Heartbeat() {
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="heartbeat">
      <span
        className={reduce ? "text-brand-500" : "anim-heart text-brand-500"}
        style={{ fontSize: 44 }}
      >
        ♥
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 呼吸球 */

/** 呼吸球：一个会呼吸的光球，box-shadow 的扩散范围跟着一起动 */
export function BreathingOrb() {
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="orb">
      <span
        className={reduce ? "h-16 w-16 rounded-full bg-brand-300" : "anim-breathe h-16 w-16 rounded-full bg-brand-300"}
        style={{ animationDuration: "6s" }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- 脉冲线 */

/** 脉冲线：SVG 心电图样条，dash 偏移让一段亮线沿着路径跑 */
export function PulseLine() {
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="pulseline">
      <svg width="200" height="60" viewBox="0 0 200 60">
        <path
          d="M 0 30 L 40 30 L 48 12 L 58 48 L 68 20 L 78 30 L 200 30"
          fill="none"
          stroke="#EBE0F7"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <path
          d="M 0 30 L 40 30 L 48 12 L 58 48 L 68 20 L 78 30 L 200 30"
          fill="none"
          stroke="#7644A7"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="46 200"
          className={reduce ? "" : "anim-snake"}
        />
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------- 倒计时 */

/** 倒计时：数字翻页而不是淡入淡出——时间在走，就该一页一页翻 */
export function Countdown() {
  const reduce = useReducedMotion();
  const [left, setLeft] = useState(5);

  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="countdown">
      <div className="relative h-12 w-12 overflow-hidden rounded-card border border-line-split bg-surface">
        <motion.span
          key={left}
          className="absolute inset-0 flex items-center justify-center text-title font-semibold text-ink-primary"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
        >
          {left > 0 ? left : "0"}
        </motion.span>
      </div>
      <button
        type="button"
        onClick={() => setLeft(5)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        重置
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 波浪线 */

/** 波浪线：整条正弦曲线横移，两端用遮罩淡出，避免"切一刀"的硬边 */
export function WaveLine() {
  const reduce = useReducedMotion();
  // 曲线画到 400，位移 -50% 即 -200：窗口始终落在有内容的区段上，不会露出空白
  const path = "M 0 30 Q 25 8 50 30 T 100 30 T 150 30 T 200 30 T 250 30 T 300 30 T 350 30 T 400 30";

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      data-lab="waveline"
    >
      <div
        className="relative w-[200px] overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, #000 18%, #000 82%, transparent)",
        }}
      >
        <svg
          width="400"
          height="60"
          viewBox="0 0 400 60"
          className={reduce ? "" : "anim-marquee"}
          style={{ animationDuration: "6s" }}
        >
          <path d={path} fill="none" stroke="#9C6BC9" strokeWidth={2.5} strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
