/**
 * 动效实验室：把全站可用的"高级动效"一次性摆出来，供挑选与验收。
 *
 * 为什么单独做一页而不是散落在各业务页面：
 * 1. 业务页面的动效必须克制（信息密度优先），没地方展示"能做什么"；
 * 2. 动效质量只能靠对比来看——一百多种放在一起，哪种廉价、哪种高级一目了然；
 * 3. 它是"选型面板"：这里选中的效果再按需下沉到列表页/详情页，
 *    而不是先在业务页写一版、不满意再改一版。
 *
 * 本页是唯一允许放开装饰的地方，但依然守两条底线：
 * - 所有无限循环动画都是低幅度、低对比（不抢阅读）；
 * - 全部尊重 prefers-reduced-motion（系统开了就退化为静态终态）。
 *
 * 页面本身不列举任何效果：所有卡片由 lab/index.ts 的注册表驱动，
 * 数量与分组只维护一处，避免"改了内容忘了改标题里的数字"。
 */

import { motion } from "framer-motion";
import { useState } from "react";

import { EffectCard, LabGroup } from "../components/lab/LabShell";
import { LAB_GROUPS, LAB_TOTAL } from "../components/lab";
import { AuroraField, SplitText } from "../components/motion";
import { Button } from "../components/ui";
import { IconRefresh, IconSparkle } from "../components/icons";
import { EASE, listContainer, listItem } from "../lib/motion";

const ADOPT = [
  {
    title: "已全站生效",
    body: "页面切换、列表逐行入场、卡片悬停、按压回弹、Toast、骨架扫光、滚动进度、错误抖动。",
  },
  {
    title: "按页面下沉",
    body: "里程表给指标卡，波纹给主操作，删除塌陷给列表，滑移指示器给标签页，折线给监控卡。",
  },
  {
    title: "只留在这里",
    body: "Gooey 融合、3D 倾斜、磁力按钮这类强装饰，业务页面积有限时不建议常驻。",
  },
];

export function MotionLabPage() {
  // 重放全部：换 key 让所有演示重新挂载，入场动画重跑一遍
  const [replay, setReplay] = useState(0);

  return (
    <div>
      {/* ---------------------------------------------------------- 页头 */}
      <div className="motion-lab-hero relative -mx-8 -mt-8 mb-9 overflow-hidden border-b border-line-split px-8 pb-9 pt-8 max-md:-mx-4 max-md:-mt-5 max-md:px-4">
        <AuroraField className="opacity-75" />
        {/* 细网格：让极光的流动有参照物，否则只是一团模糊的色 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(118,68,167,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(118,68,167,0.06) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
          aria-hidden="true"
        />

        <div className="relative">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] tracking-wide text-brand-600"
          >
            <IconSparkle size={12} />
            MOTION LAB
          </motion.div>

          <h1 key={`hero-${replay}`} className="mt-3 text-h1 text-ink-primary">
            <SplitText text={`${LAB_TOTAL} 种会让手停下来的动效`} stagger={0.032} />
          </h1>

          <p className="mt-2 max-w-[600px] text-body leading-6 text-ink-tertiary">
            这是全站唯一允许「放开」的区域：材质、物理、光影、文字、反馈、数据、空间、
            手势、节奏、编排十二组，每一种都能直接上手操作。选中的效果再按需要下沉到业务页面，
            而不是先在业务页写一版、不满意再改一版。
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              icon={<IconRefresh size={14} />}
              onClick={() => setReplay((n) => n + 1)}
            >
              重放全部
            </Button>
            <span className="text-caption text-ink-tertiary">
              {LAB_TOTAL} 个效果 · 全部可交互 · 尊重 prefers-reduced-motion
            </span>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- 效果 */}
      <div key={`grid-${replay}`}>
        {LAB_GROUPS.map((group) => (
          <LabGroup key={group.index} index={group.index} title={group.title} desc={group.desc}>
            {group.items.map((item) => (
              <EffectCard
                key={item.name}
                name={item.name}
                note={item.note}
                height={item.height}
                bare={item.bare}
              >
                {item.node}
              </EffectCard>
            ))}
          </LabGroup>
        ))}
      </div>

      {/* ---------------------------------------------------------- 落地说明 */}
      <motion.div
        className="mt-11 rounded-card border border-line-split bg-surface px-5 py-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE, delay: 0.1 }}
      >
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.18 }}
        >
          <IconSparkle size={14} />
          <h2 className="text-subtitle text-ink-primary">怎么用</h2>
        </motion.div>
        <motion.div
          className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3"
          variants={listContainer}
          initial="initial"
          animate="animate"
        >
          {ADOPT.map((item) => (
            <motion.div key={item.title} variants={listItem}>
              <div className="text-caption font-medium text-ink-primary">{item.title}</div>
              <p className="mt-1 text-caption leading-5 text-ink-tertiary">{item.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
