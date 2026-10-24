/**
 * 实验场骨架：分组标题 + 效果卡片壳。
 *
 * 为什么单独抽壳：12 个效果如果各自写一遍卡片边框、标题、说明，
 * 只要有一处 8px 圆角和 1px 描边写歪，整页就会显得廉价。
 * 效果本身放在 effects-*.tsx 里，这里只管「怎么摆」。
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import { EASE } from "../../lib/motion";

export function LabGroup({
  index,
  title,
  desc,
  children,
}: {
  index: string;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-11 first:mt-0">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] tracking-widest text-brand-400">{index}</span>
        <h2 className="text-subtitle text-ink-primary">{title}</h2>
        <span className="text-caption text-ink-tertiary">{desc}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

export function EffectCard({
  name,
  note,
  children,
  height = 220,
  bare = false,
}: {
  name: string;
  note: string;
  children: ReactNode;
  height?: number;
  /** bare：演示区自己铺满（例如滚动容器），不要额外留白与背景 */
  bare?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.5, ease: EASE }}
      className="group overflow-hidden rounded-card border border-line-split bg-surface shadow-card transition-shadow duration-300 hover:shadow-popup"
    >
      <div
        className={
          "relative overflow-hidden " +
          (bare
            ? "bg-surface-fill"
            : "flex items-center justify-center bg-surface-fill")
        }
        style={{ height }}
      >
        {children}
      </div>
      <div className="border-t border-line-split px-4 py-3">
        <div className="text-body font-medium text-ink-primary">{name}</div>
        <div className="mt-0.5 text-caption leading-5 text-ink-tertiary">{note}</div>
      </div>
    </motion.div>
  );
}
