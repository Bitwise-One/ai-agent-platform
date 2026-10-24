/**
 * 基础组件库（企业后台风格）。
 *
 * 统一在这里定义而不是各页面自己写：按钮层级、输入框高度、卡片内边距、
 * 状态标签配色一旦分散，界面很快就会出现「三种蓝、四种灰」的失控。
 *
 * 关键约束（与 docs 中的令牌一致）：
 * - 控件高度 32px（输入/下拉/次按钮），主按钮同高，保证行内对齐；
 * - 圆角上限 8px，卡片 8px、控件 6px、标签 2px；
 * - 阴影只用于浮层（弹窗、下拉），列表与卡片靠 1px 描边分区。
 */

import clsx from "clsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AnimatePresence, motion } from "framer-motion";

import { EASE } from "../lib/motion";
import { IconAlert, IconCheck, IconClose } from "./icons";
import { EmptyArt, LoadingRing, RippleLayer, ShakeBox, useRipple } from "./motion";

/* ------------------------------------------------------------------ 按钮 */

type ButtonVariant = "primary" | "default" | "dashed" | "text" | "danger";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-control text-body font-normal " +
  "transition-colors duration-150 ease-enterprise disabled:cursor-not-allowed disabled:opacity-50 " +
  "whitespace-nowrap select-none";

const buttonVariants: Record<ButtonVariant, string> = {
  // 主操作：整页只允许出现一个
  primary: "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700",
  default: "bg-white text-ink-primary border border-line-base hover:border-brand-400 hover:text-brand-600",
  dashed: "bg-white text-ink-secondary border border-dashed border-line-base hover:border-brand-400 hover:text-brand-600",
  text: "text-brand-600 hover:bg-brand-50 px-1",
  danger: "bg-white text-[#CF1322] border border-[#FFCCC7] hover:bg-[#FFF1F0]",
};

export interface ButtonProps
  // 用 motion.button 后，framer 的动画回调与 React 的同名事件类型冲突，先剔掉再声明
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"
  > {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  // 波纹挂在按钮自己身上：全站所有按钮自动获得「按下点反馈」，不用各页单独接
  const { items, spawn } = useRipple();
  const { onPointerDown, ...restProps } = rest;
  const inert = disabled || loading;

  return (
    <motion.button
      type="button"
      className={clsx(
        buttonBase,
        "relative overflow-hidden",
        buttonVariants[variant],
        size === "sm" ? "h-7 px-2.5 text-caption" : "h-8 px-3.5",
        className,
      )}
      disabled={inert}
      // 全站按钮统一的"按下去有实体感"：只压 3%，弹回比按下更慢一点
      whileTap={inert ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 520, damping: 28, mass: 0.6 }}
      onPointerDown={(event) => {
        if (!inert) spawn(event);
        onPointerDown?.(event);
      }}
      {...restProps}
    >
      {/* 内容层抬高一层，避免被波纹盖住颜色 */}
      <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
        {loading ? <LoadingRing size={12} thickness={2} /> : icon}
        {children}
      </span>
      <RippleLayer items={items} />
    </motion.button>
  );
}

/* ------------------------------------------------------------------ 表单 */

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-caption text-ink-secondary">
        {required && <span className="text-[#FF4D4F]">*</span>}
        {label}
      </span>
      {children}
      {error ? (
        // key={error}：同一条错误再次提交也要重新抖一次，否则用户会以为「没反应」
        <motion.span
          key={error}
          initial={{ opacity: 0, y: -3, x: 0 }}
          animate={{ opacity: 1, y: 0, x: [0, -3, 3, -2, 1, 0] }}
          transition={{ duration: 0.34, ease: EASE }}
          className="mt-1 block text-caption text-[#CF1322]"
          role="alert"
        >
          {error}
        </motion.span>
      ) : hint ? (
        <span className="mt-1 block text-caption text-ink-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}

const controlClass =
  "w-full rounded-control border border-line-base bg-white px-2.5 text-body text-ink-primary " +
  "placeholder:text-ink-tertiary transition-colors duration-150 hover:border-brand-300 " +
  "focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-surface-fill";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(controlClass, "h-8", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(controlClass, "scroll-slim min-h-[72px] py-1.5 leading-6", className)}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(controlClass, "h-8 cursor-pointer pr-6", className)} {...rest}>
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      whileTap={{ scale: 0.94 }}
      className="relative h-5 w-9 shrink-0 rounded-full"
      animate={{ backgroundColor: checked ? "#7644A7" : "#D9D9D9" }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* 滑块用弹簧而不是线性位移：越过中点时会有一点点"被吸住"的迟滞 */}
      <motion.span
        className="absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
        animate={{ x: checked ? 18 : 2 }}
        transition={{ type: "spring", stiffness: 520, damping: 30, mass: 0.6 }}
      />
    </motion.button>
  );
}

/* ------------------------------------------------------------------ 容器 */

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-card border border-line-split bg-surface shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  extra,
}: {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-split px-6 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-subtitle text-ink-primary">{title}</div>
        {description && (
          <p className="mt-1 text-caption text-ink-tertiary">{description}</p>
        )}
      </div>
      {extra && <div className="flex shrink-0 items-center gap-2">{extra}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  // 标题比描述早 60ms、比操作按钮早 100ms：视线自然从"这是哪"落到"能做什么"
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <motion.h1
          className="text-h1 text-ink-primary"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          {title}
        </motion.h1>
        {description && (
          <motion.p
            className="mt-1.5 text-body text-ink-tertiary"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.06 }}
          >
            {description}
          </motion.p>
        )}
      </div>
      {actions && (
        <motion.div
          className="flex shrink-0 items-center gap-2"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.1 }}
        >
          {actions}
        </motion.div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 状态 */

export type StatusTone = "success" | "info" | "warning" | "error" | "default";

const toneClass: Record<StatusTone, string> = {
  success: "bg-state-success-bg text-state-success-fg",
  info: "bg-state-info-bg text-state-info-fg",
  warning: "bg-state-warning-bg text-state-warning-fg",
  error: "bg-state-error-bg text-state-error-fg",
  default: "bg-surface-fill text-ink-secondary",
};

const dotClass: Record<StatusTone, string> = {
  success: "bg-state-success-fg",
  info: "bg-state-info-fg",
  warning: "bg-state-warning-fg",
  error: "bg-state-error-fg",
  default: "bg-ink-tertiary",
};

/** 状态标签：浅底 + 深字 + 同色点，保证不依赖颜色也能读出语义 */
export function StatusTag({
  tone = "default",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption",
        toneClass[tone],
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5 items-center justify-center">
        {/* 点本身弹入：表格逐行出现时，状态是最后被「点亮」的那一下 */}
        <motion.span
          className={clsx("h-1.5 w-1.5 rounded-full", dotClass[tone])}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 22, mass: 0.5, delay: 0.06 }}
        />
        {/* info 语义是「进行中」，给一圈常驻扩散——静止的点读不出「还在跑」 */}
        {tone === "info" && (
          <span
            className={clsx("anim-ping absolute inset-0 rounded-full", dotClass[tone])}
            aria-hidden="true"
          />
        )}
      </span>
      {children}
    </span>
  );
}

/** 任务/工作流状态到语义色的映射（与后端 TaskStatus 对齐） */
export function taskTone(status: string): StatusTone {
  switch (status) {
    case "completed":
    case "active":
    case "indexed":
    case "released":
      return "success";
    case "running":
    case "created":
    case "waiting_human":
    case "draft":
      return "info";
    case "degraded":
    case "timed_out":
      return "warning";
    case "failed":
    case "cancelled":
      return "error";
    case "escalated":
      return "warning";
    default:
      return "default";
  }
}

const taskText: Record<string, string> = {
  completed: "已完成",
  running: "执行中",
  created: "已创建",
  waiting_human: "待人工",
  degraded: "降级",
  timed_out: "超时",
  failed: "失败",
  cancelled: "已取消",
  escalated: "转人工",
  active: "启用",
  disabled: "停用",
  draft: "草稿",
  indexed: "已索引",
  pending: "待处理",
  released: "已发布",
};

export function statusText(status: string): string {
  return taskText[status] ?? status;
}

/* ------------------------------------------------------------------ 反馈 */

export function Spinner({ size = 14 }: { size?: number }) {
  // 缺口圆弧比整圈边框更有"指向"，同一个 LoadingRing 在按钮里也用，口径统一
  return (
    <span className="inline-flex items-center opacity-70" role="status" aria-label="加载中">
      <LoadingRing size={size} thickness={2} />
    </span>
  );
}

/**
 * 空状态：插画 + 标题 + 操作。
 *
 * 空状态最怕「死」——一块空白加一行字，用户会怀疑是不是没加载出来。
 * 插画里的虚线轨道一直在极慢自转，传达「这里是有生命的，只是在等你」。
 */
export function Empty({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: EASE }}
      className={clsx(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-line-base bg-surface text-center",
        compact ? "px-6 py-8" : "px-6 py-16",
      )}
    >
      <EmptyArt size={compact ? 62 : 92} className="mb-3.5" />

      <motion.p
        className="text-body font-medium text-ink-primary"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease: EASE, delay: 0.1 }}
      >
        {title}
      </motion.p>

      {description && (
        <motion.p
          className="mt-1 max-w-md text-caption leading-6 text-ink-tertiary"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: EASE, delay: 0.16 }}
        >
          {description}
        </motion.p>
      )}

      {action && (
        <motion.div
          className="mt-4"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: EASE, delay: 0.22 }}
        >
          {action}
        </motion.div>
      )}
    </motion.div>
  );
}

/** 错误条：出现时横向抖一下——抖动是全站最强的注意力手段之一，只给「出错了」用 */
export function ErrorNote({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <ShakeBox trigger={message}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="flex items-center justify-between gap-4 rounded-control border border-[#FFCCC7] bg-[#FFF1F0] px-3 py-2 text-body text-[#CF1322]"
      >
        <span className="flex items-center gap-2">
          <IconAlert size={14} />
          {message}
        </span>
        {onRetry && (
          <Button size="sm" variant="text" onClick={onRetry}>
            重试
          </Button>
        )}
      </motion.div>
    </ShakeBox>
  );
}

export function Skeleton({ className }: { className?: string }) {
  // 扫光而不是整块呼吸：呼吸让骨架块本身变淡变浓，扫光更像"有条数据正在流过去"
  return <div className={clsx("sk-shimmer rounded-control", className)} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ 表格 */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-slim overflow-x-auto">
      <table className="w-full border-collapse text-body">{children}</table>
    </div>
  );
}

/**
 * 动画表格行：全站列表统一用它代替裸 `<tr>`。
 *
 * 逐行入场而不是整表淡入——用户扫读时视线是从上往下走的，
 * 逐行出现正好把这条路径"铺"出来。index 超过 14 之后不再累加延迟，
 * 否则长列表的最后一屏要等好几秒。
 */
export function Tr({
  index = 0,
  className,
  children,
}: {
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: Math.min(index, 14) * 0.028 }}
      className={className}
    >
      {children}
    </motion.tr>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={clsx(
        "h-[44px] whitespace-nowrap border-b border-line-split bg-surface-header px-4 text-caption font-medium text-ink-secondary",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      className={clsx(
        "border-b border-line-split px-4 py-3 align-middle text-ink-primary",
        align === "right" && "text-right tabular",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ 弹窗 */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // 弹窗打开时锁滚动，避免背景跟随滚动
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-6 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative w-full rounded-card border border-line-split bg-surface shadow-popup"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: -8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="flex items-center justify-between border-b border-line-split px-6 py-4">
              <h2 className="text-subtitle text-ink-primary">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="rounded-control p-1 text-ink-tertiary hover:bg-surface-fill hover:text-ink-secondary"
              >
                <IconClose size={16} />
              </button>
            </div>
            <div className="scroll-slim max-h-[64vh] overflow-y-auto px-6 py-5">{children}</div>
            {footer && (
              <div className="flex justify-end gap-2 border-t border-line-split px-6 py-3.5">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ 轻提示 */

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<{
  push: (message: string, tone?: ToastTone) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    // 2.4s 后自动消失，错误多留 1s 便于阅读
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, tone === "error" ? 3400 : 2400);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        <AnimatePresence>
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className={clsx(
                "pointer-events-auto flex items-center gap-2 rounded-control border px-3 py-2 text-body shadow-popup",
                item.tone === "success" && "border-[#B7EB8F] bg-white text-[#389E0D]",
                item.tone === "error" && "border-[#FFCCC7] bg-white text-[#CF1322]",
                item.tone === "info" && "border-[#91CAFF] bg-white text-[#0958D9]",
              )}
            >
              {item.tone === "error" ? <IconAlert size={14} /> : <IconCheck size={14} />}
              {item.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}
