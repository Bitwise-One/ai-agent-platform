/**
 * 状态组：一切「系统现在怎么了」的表达。
 *
 * 这一组是动效里最该克制的一组——用户只有在不确定的时候才需要它。
 * 所以判据是：状态变化必须**只在该变化时出现**，不该常驻，不该抢焦点。
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import { EASE } from "../../lib/motion";

/* ---------------------------------------------------------------- 成功迸发 */

const CONFETTI = Array.from({ length: 14 }, (_, i) => ({
  angle: (i / 14) * Math.PI * 2,
  distance: 30 + (i % 3) * 12,
  size: 4 + (i % 3) * 2,
  color: ["#0D7665", "#39B69A", "#8EE3AE", "#FFD591"][i % 4],
}));

/** 成功迸发：勾先画出，再炸出一圈彩屑——先确认，再庆祝，顺序不能反 */
export function SuccessBurst() {
  const reduce = useReducedMotion();
  const [round, setRound] = useState(0);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="burst">
      <div className="relative h-16 w-16">
        {round > 0 && (
          <>
            {CONFETTI.map((piece, index) => (
              <motion.span
                key={`${round}-${index}`}
                className="absolute left-1/2 top-1/2 rounded-sm"
                style={{ width: piece.size, height: piece.size, background: piece.color }}
                initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                animate={{
                  x: Math.cos(piece.angle) * piece.distance,
                  y: Math.sin(piece.angle) * piece.distance,
                  opacity: [0, 1, 0],
                  scale: [0, 1, 0.6],
                  rotate: 180,
                }}
                transition={{ duration: 0.75, ease: EASE, delay: 0.18 + (index % 3) * 0.03 }}
              />
            ))}
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-[#68E1A6]"
              initial={{ scale: 0.6, opacity: 0.8 }}
              animate={{ scale: 1.7, opacity: 0 }}
              transition={{ duration: 0.55, ease: EASE, delay: 0.1 }}
            />
          </>
        )}

        <svg viewBox="0 0 32 32" className="absolute inset-0 h-full w-full">
          {round > 0 && (
            <motion.path
              key={`check-${round}`}
              d="M 8 17 L 14 23 L 24 10"
              fill="none"
              stroke="#68E1A6"
              strokeWidth={3}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduce ? 0 : 0.42, ease: EASE }}
            />
          )}
        </svg>
      </div>

      <button
        type="button"
        onClick={() => setRound((n) => n + 1)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        标记完成
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 错误卡片 */

/** 错误卡片：边框先红、再抖，最后常驻一圈极慢的红晕——三个层次表达"出错了" */
export function ErrorCard() {
  const reduce = useReducedMotion();
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="errorcard">
      <motion.div
        className="w-[168px] rounded-control border bg-surface px-3 py-2.5 text-caption"
        animate={
          reduce || !failed
            ? { borderColor: "rgba(217,217,217,1)", x: 0 }
            : {
                borderColor: ["#52645D", "#FF8490", "#A25E67"],
                x: [0, -6, 5, -4, 2, 0],
              }
        }
        transition={{ duration: reduce ? 0 : 0.5, ease: "easeInOut", x: { duration: 0.44 } }}
      >
        <div className="font-medium text-ink-primary">调用模型网关</div>
        <div className={failed ? "text-[#FF9DA6]" : "text-ink-tertiary"}>
          {failed ? "连接超时（30s）" : "等待执行"}
        </div>
      </motion.div>

      <button
        type="button"
        onClick={() => setFailed((f) => !f)}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        {failed ? "恢复正常" : "触发失败"}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 勾选弹跳 */

/** 勾选弹跳：勾自己画出来，外框同时弹一下——两个动作同源但不同速 */
export function CheckPop() {
  const [on, setOn] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="check">
      <motion.button
        type="button"
        onClick={() => setOn((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-control border-2"
        style={{ borderColor: on ? "#68E1A6" : "#52645D", background: on ? "#193A2C" : "#FFFFFF" }}
        animate={reduce ? {} : { scale: on ? [1, 1.18, 1] : 1 }}
        transition={{ duration: 0.32, ease: EASE }}
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7">
          <motion.path
            d="M 5 13 L 10 18 L 19 7"
            fill="none"
            stroke="#68E1A6"
            strokeWidth={2.5}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: on ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.34, ease: EASE }}
          />
        </svg>
      </motion.button>
    </div>
  );
}

/* ---------------------------------------------------------------- 昼夜开关 */

/** 昼夜开关：滑块过去之后，图标跟着换——"状态迁移"比"状态翻转"更好懂 */
export function DayNightSwitch() {
  const [night, setNight] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background: night ? "#14211C" : "#EEF9F3",
        transition: reduce ? undefined : "background 0.45s ease",
      }}
      data-lab="daynight"
    >
      <button
        type="button"
        onClick={() => setNight((v) => !v)}
        aria-label="切换昼夜"
        className="relative h-8 w-16 rounded-full border border-line-base"
        style={{ background: night ? "#0A5249" : "#FFD591" }}
      >
        <motion.span
          className="absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm"
          animate={{ x: night ? 34 : 4 }}
          transition={{ type: "spring", stiffness: 520, damping: 30, mass: 0.6 }}
        />
        <motion.span
          className="absolute top-1/2 -translate-y-1/2 text-[10px]"
          style={{ left: night ? 8 : 34, color: night ? "#DDF7EB" : "#E8BD73" }}
          animate={{ opacity: 1 }}
        >
          {night ? "夜" : "日"}
        </motion.span>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 步骤进度 */

/** 步骤进度：连接线按比例填充，标签在"到达"时才亮——避免全程都在闪 */
export function StepProgress() {
  const [step, setStep] = useState(2);
  const labels = ["创建", "配置", "测试", "发布"];
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5" data-lab="steps">
      <div className="flex items-center">
        {labels.map((label, index) => (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <motion.span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[11px]"
                style={{
                  background: index <= step ? "#0D7665" : "#34453D",
                  color: index <= step ? "#FFFFFF" : "rgba(151,170,161,1)",
                }}
                animate={reduce ? {} : { scale: index === step ? 1.14 : 1 }}
                transition={{ type: "spring", stiffness: 460, damping: 24 }}
              >
                {index + 1}
              </motion.span>
              <span className={index <= step ? "text-[11px] text-brand-600" : "text-[11px] text-ink-tertiary"}>
                {label}
              </span>
            </div>
            {index < labels.length - 1 && (
              <div className="mx-1 h-0.5 w-8 bg-[#34453D]">
                <motion.div
                  className="h-full bg-brand-500"
                  initial={{ width: 0 }}
                  animate={{ width: index < step ? "100%" : 0 }}
                  transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary"
        >
          上一步
        </button>
        <button
          type="button"
          onClick={() => setStep((s) => Math.min(3, s + 1))}
          className="rounded-control border border-line-base bg-surface px-2.5 py-1 text-caption text-ink-secondary"
        >
          下一步
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 上传进度 */

/** 上传进度：进度条 + 已传字节双轨推进，比一个百分比数字更"有过程" */
export function UploadProgress() {
  const reduce = useReducedMotion();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (progress >= 100) return;
    const timer = window.setTimeout(() => setProgress((p) => Math.min(100, p + 4)), 90);
    return () => window.clearTimeout(timer);
  }, [progress]);

  const done = progress >= 100;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" data-lab="upload">
      <div className="w-[190px] rounded-control border border-line-split bg-surface px-3 py-2.5">
        <div className="flex items-center justify-between text-caption">
          <span className="text-ink-primary">售后政策.pdf</span>
          <span className="tabular text-ink-tertiary">{progress}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#34453D]">
          <motion.div
            className="h-full rounded-full"
            style={{ background: done ? "#68E1A6" : "#0D7665" }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: reduce ? 0 : 0.18, ease: "linear" }}
          />
        </div>
        <div className="mt-1.5 text-[11px] text-ink-tertiary">
          {done ? "已入库 · 128 个片段" : `${Math.round(progress * 1.28)} / 128 片段`}
        </div>
      </div>

      {done && (
        <button
          type="button"
          onClick={() => setProgress(0)}
          className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary"
        >
          再传一次
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 离线重试 */

/** 离线重试：退避间隔逐次变长（1s→2s→4s），并把"第几次"明说出来 */
export function OfflineRetry() {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const backoff = 2 ** Math.min(attempt, 3) * 400;
    const timer = window.setTimeout(() => setAttempt((a) => a + 1), backoff);
    return () => window.clearTimeout(timer);
  }, [attempt]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2" data-lab="offline">
      <div className="flex items-center gap-1.5 text-caption text-ink-secondary">
        <span className="h-1.5 w-1.5 rounded-full bg-[#E8BD73]" />
        连接中断，正在重试
        <span className="anim-dots inline-flex w-3 gap-0.5 text-brand-500">
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
        </span>
      </div>
      <span className="text-[11px] text-ink-tertiary">
        第 {attempt + 1} 次 · 间隔 {2 ** Math.min(attempt, 3)}s（指数退避）
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 空态呼吸 */

/** 空态呼吸：一个光圈在极慢地明暗，传达"这里是活的，只是在等你" */
export function EmptyBreathe() {
  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="breathe">
      <span className="anim-breathe h-16 w-16 rounded-full bg-brand-100" />
    </div>
  );
}

/* ---------------------------------------------------------------- 徽标角标 */

/** 徽标角标：数字变化时角标弹一下，同时旧数字向上翻走——"有新东西"要看得见 */
export function BadgePop() {
  const [count, setCount] = useState(3);
  const [pulse, setPulse] = useState(0);
  const reduce = useReducedMotion();

  const bump = () => {
    setCount((c) => c + 1);
    setPulse((p) => p + 1);
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4" data-lab="badge">
      <div className="relative">
        <span className="flex h-12 w-12 items-center justify-center rounded-card border border-line-split bg-surface text-ink-tertiary">
          🔔
        </span>
        <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center overflow-hidden rounded-full bg-[#FF9DA6] px-1">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={count}
              className="tabular block text-[10px] leading-none text-white"
              initial={reduce ? { opacity: 0 } : { y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { y: -12, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
            >
              {count}
            </motion.span>
          </AnimatePresence>
        </span>
        <motion.span
          key={`halo-${pulse}`}
          className="pointer-events-none absolute -right-2 -top-2 h-5 w-5 rounded-full border-2 border-[#FF8490]"
          initial={{ scale: 1, opacity: 0.8 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        />
      </div>
      <button
        type="button"
        onClick={bump}
        className="rounded-control border border-line-base bg-surface px-3 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        来一条新消息
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 分段进度环 */

/** 分段环：conic-gradient 的硬边扇区，扫过去表示"在巡检" */
export function SegmentRing() {
  return (
    <div className="flex h-full w-full items-center justify-center" data-lab="segment">
      <span
        className="anim-orbit-slow relative h-16 w-16 rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, #0D7665 0deg 30deg, transparent 30deg 60deg, #39B69A 60deg 90deg, transparent 90deg 120deg, #0D7665 120deg 150deg, transparent 150deg 180deg, #39B69A 180deg 210deg, transparent 210deg 240deg, #0D7665 240deg 270deg, transparent 270deg 300deg, #39B69A 300deg 330deg, transparent 330deg 360deg)",
          maskImage: "radial-gradient(circle, transparent 52%, #000 54%)",
          WebkitMaskImage: "radial-gradient(circle, transparent 52%, #000 54%)",
        }}
      />
    </div>
  );
}
