/**
 * 动效实验室：把全站可用的"高级动效"一次性摆出来，供挑选与验收。
 *
 * 为什么单独做一页而不是散落在各业务页面：
 * 1. 业务页面的动效必须克制（信息密度优先），没地方展示"能做什么"；
 * 2. 动效质量只能靠对比来看——十二种放在一起，哪种廉价、哪种高级一目了然；
 * 3. 它是"选型面板"：这里选中的效果再按需下沉到列表页/详情页，
 *    而不是先在业务页写一版、不满意再改一版。
 *
 * 本页是唯一允许放开装饰的地方，但依然守两条底线：
 * - 所有无限循环动画都是低幅度、低对比（不抢阅读）；
 * - 全部尊重 prefers-reduced-motion（系统开了就退化为静态终态）。
 */

import { motion } from "framer-motion";
import { useState } from "react";

import { EffectCard, LabGroup } from "../components/lab/LabShell";
import { GooeyBlobs, LiquidLoader, SplashStage } from "../components/lab/effects-fluid";
import { ShimmerBorder, ScrollDepth, TiltCard } from "../components/lab/effects-light";
import { DragCard, MagneticButton, ShuffleGrid } from "../components/lab/effects-physics";
import { CharRevealDemo, OdometerDemo, StreamTyper, SplitText } from "../components/lab/effects-type";
import { AuroraField } from "../components/motion";
import { Button } from "../components/ui";
import { IconRefresh, IconSparkle } from "../components/icons";
import { EASE } from "../lib/motion";

const ADOPT = [
  {
    title: "已全站生效",
    body: "页面切换、列表逐项入场、卡片悬停、按压反馈、Toast、骨架屏淡出。",
  },
  {
    title: "按页面下沉",
    body: "里程表数字给指标卡，磁力按钮给主操作，FLIP 洗牌给筛选与排序。",
  },
  {
    title: "只留在这里",
    body: "Gooey 融合、3D 倾斜这类强装饰，业务页面积有限时不建议常驻。",
  },
];

export function MotionLabPage() {
  // 重放全部：换 key 让所有演示重新挂载，入场动画重跑一遍
  const [replay, setReplay] = useState(0);

  return (
    <div>
      {/* ---------------------------------------------------------- 页头 */}
      <div className="relative -mx-6 -mt-6 mb-9 overflow-hidden border-b border-line-split bg-surface px-6 pb-9 pt-8">
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
            <SplitText text="十二种会让手停下来的动效" stagger={0.032} />
          </h1>

          <p className="mt-2 max-w-[600px] text-body leading-6 text-ink-tertiary">
            这是全站唯一允许「放开」的区域：液体、物理、光影、文字四组，
            每一种都能直接上手操作。选中的效果再按需要下沉到业务页面，
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
              12 个效果 · 全部可交互 · 尊重 prefers-reduced-motion
            </span>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- 效果 */}
      <div key={`grid-${replay}`}>
        <LabGroup index="01" title="液体与材质" desc="表面张力、形变、溅射——让界面有「物质感」">
          <EffectCard
            name="Gooey 磁吸水滴"
            note="三层不同刚度的 spring 叠加 + SVG alpha 融合滤镜。靠近时粘连、拉开时拉丝断裂。"
          >
            <GooeyBlobs />
          </EffectCard>

          <EffectCard
            name="液态形变加载器"
            note="不规则 border-radius 关键帧 + 缓慢自转 + 高光。比转圈图标更能表达「正在酝酿」。"
          >
            <LiquidLoader />
          </EffectCard>

          <EffectCard
            name="水滴分溅 2.0"
            note="主溅射落地后 130ms 补一发偏移的二次溅射，模拟真实液体的二次飞溅。"
          >
            <SplashStage />
          </EffectCard>
        </LabGroup>

        <LabGroup index="02" title="物理与运动" desc="刚度、阻尼、惯性——手感来自于参数而不是关键帧">
          <EffectCard
            name="弹簧拖拽甩卡"
            note="松手按甩出速度做惯性回弹（bounceStiffness 330 / damping 15），并即时显示速度。"
          >
            <DragCard />
          </EffectCard>

          <EffectCard
            name="磁力按钮"
            note="光标进入 150px 引力场后按钮被牵引，内部文字再乘 0.35 形成视差——磁铁与被吸附物的错位。"
          >
            <MagneticButton />
          </EffectCard>

          <EffectCard
            name="布局洗牌（FLIP）"
            note="只改数据顺序，位置补间交给 layout。列表筛选、看板拖拽、排序都能直接复用。"
          >
            <ShuffleGrid />
          </EffectCard>
        </LabGroup>

        <LabGroup index="03" title="光影与纵深" desc="视角、光源、景深——让平面产生厚度">
          <EffectCard
            name="3D 倾斜卡"
            note="perspective + 双轴旋转跟随光标，内容按 translateZ 分层，高光贴在卡面上（mix-blend-overlay）。"
            height={240}
          >
            <TiltCard />
          </EffectCard>

          <EffectCard
            name="流光描边 + 光标聚光"
            note="conic-gradient 在 1px 边框槽里旋转，面板内另有一团跟随光标的聚光；两层光不同步才显得真实。"
            height={240}
          >
            <ShimmerBorder />
          </EffectCard>

          <EffectCard
            name="滚动景深"
            note="由容器自身的 scrollYProgress 驱动，越远的层移动越慢、越淡——视差必须挂在滚动进度上才不假。"
            height={240}
            bare
          >
            <ScrollDepth />
          </EffectCard>
        </LabGroup>

        <LabGroup index="04" title="文字与数据" desc="逐字、逐位、逐帧——让「内容在变」这件事可追踪">
          <EffectCard
            name="逐字 3D 翻入"
            note="每个字绕底边翻 92° 落下，父层必给 perspective，否则只是把字压扁。"
          >
            <CharRevealDemo />
          </EffectCard>

          <EffectCard
            name="里程表数字"
            note="每一位是一条 0–9 竖条，改数字就是平移它。能看清「是哪一位在进位」，比整体跳变高级。"
          >
            <OdometerDemo />
          </EffectCard>

          <EffectCard
            name="流式打字 + 声纹"
            note="打字时光标闪动、声纹跳动；打完后声纹落回静止。把「模型还在算」变成可感知的节拍。"
          >
            <StreamTyper />
          </EffectCard>
        </LabGroup>
      </div>

      {/* ---------------------------------------------------------- 落地说明 */}
      <div className="mt-11 rounded-card border border-line-split bg-surface px-5 py-4">
        <div className="flex items-center gap-2">
          <IconSparkle size={14} />
          <h2 className="text-subtitle text-ink-primary">怎么用</h2>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
          {ADOPT.map((item) => (
            <div key={item.title}>
              <div className="text-caption font-medium text-ink-primary">{item.title}</div>
              <p className="mt-1 text-caption leading-5 text-ink-tertiary">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
