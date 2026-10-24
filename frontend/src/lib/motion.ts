/**
 * 动效语言：一处定义，全局复用。
 *
 * 三条原则（写完回头看，避免「炫技压过信息」）：
 * 1. **进场统一用 expo-out**：快起慢收，符合「有质量感」的直觉，不用线性；
 * 2. **位移不超过 12px**：B 端的信息密度大，位移一大眼睛就要重新对焦；
 * 3. **液体感只给「反馈时刻」**：创建节点、发布版本、消息到达——这些是需要
 *    被注意到的瞬间；表格滚动、列表 hover 一律保持克制。
 */

import type { Transition, Variants } from "framer-motion";

/** expo-out：起步快、收尾软，是「高级感」最省力的来源 */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** 通用弹性：用于位移与布局变化（导航选中态、卡片入场） */
export const spring: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.9,
};

/** 更软的弹性：大块元素（弹窗、画布节点）用它，避免弹得太跳 */
export const softSpring: Transition = {
  type: "spring",
  stiffness: 240,
  damping: 26,
  mass: 1,
};

/** 页面级切换：淡入 + 轻微上浮，退场更快（不让用户等动画） */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.14, ease: "easeIn" } },
};

/** 列表容器：子项依次入场（stagger 比同时出现更容易被读懂） */
export const listContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.045, delayChildren: 0.03 },
  },
};

export const listItem: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

/** 单个卡片的入场（无容器时用，靠 delay 手工错峰） */
export const riseIn = (delay = 0): Variants => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE, delay } },
});

/** 反馈时刻的「液体感」：按压缩一下再弹回 */
export const tapScale = { scale: 0.98 };
export const hoverLift = { y: -1 };
