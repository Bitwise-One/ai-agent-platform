/**
 * 动效目录：全站 120 个效果的总注册表。
 *
 * 为什么用注册表而不是在页面里手写卡片：
 * 1. 页面只负责「摆」，效果元数据集中一处，增删效果不用碰页面；
 * 2. 数量写死成字面量（"十二种"/"二十种"）是上一次改版漏改的根源，
 *    现在页头数量直接由数组长度算出来；
 * 3. 顺序即叙事：从材质到编排，由具体到抽象，方便按组验收。
 *
 * 每个条目：
 * - name / note：卡片标题与一句话说明（说明必须写清"为什么这么做"）；
 * - node：演示节点，直接给元素而不是工厂函数——演示组件自带状态，
 *   靠外层 key 重挂载来重置；
 * - height / bare：卡片演示区的高度，以及是否铺满（滚动类演示需要）。
 */

import type { ReactNode } from "react";

import { GooeyBlobs, LiquidLoader, SplashStage } from "./effects-fluid";
import {
  BadgePop,
  CheckPop,
  DayNightSwitch,
  EmptyBreathe,
  ErrorCard,
  OfflineRetry,
  SegmentRing,
  StepProgress,
  SuccessBurst,
  UploadProgress,
} from "./effects-state";
import {
  BubbleRise,
  FrostMelt,
  GlassPanel,
  InkBloom,
  LavaLamp,
  LiquidTrail,
  MercuryDrop,
  RipplePond,
  TensionDrop,
  ViscousBlob,
} from "./effects-material";
import {
  BouncingBall,
  FreeFall,
  InertiaToss,
  Parachute,
  PendulumSwing,
  RubberBand,
  SpinningTop,
  SpringChain,
  TossCatch,
  WhipLash,
} from "./effects-motion";
import {
  GradientTitle,
  HoloFoil,
  LensFlare,
  NeonFlicker,
  ParallaxLayers,
  PrismSplit,
  RayBurst,
  ShadowLift,
  Spotlight,
  TextShine,
} from "./effects-glow";
import {
  CaretBlink,
  CountRing,
  DisperseText,
  GlitchTyper,
  Marquee,
  ScrambleText,
  QuoteTicker,
  WordFlip,
  WordMorph,
  CharWave,
} from "./effects-glyph";
import {
  CardStack,
  DonutChart,
  GaugeMeter,
  HeatmapGrid,
  KpiFlip,
  PageSlide,
  SortFlip,
  TimelineDraw,
  TreemapGrow,
  TreeExpand,
} from "./effects-layout";
import {
  CubeSpin,
  Coverflow,
  DealDeck,
  DoorOpen,
  FlipCard,
  FlipClock,
  FoldPanels,
  HelixTower,
  CylinderScroll,
  PerspectiveGrid,
} from "./effects-spatial";
import {
  DoubleTapZoom,
  DragReorder,
  FlingCard,
  LongPress,
  OverscrollGlow,
  PinchZoom,
  PullRefresh,
  ScrubReveal,
  SwipeDismiss,
  SwipeReveal,
} from "./effects-gesture";
import {
  BeatPulse,
  BreathingOrb,
  Countdown,
  Equalizer,
  Heartbeat,
  PulseLine,
  RadarSweep,
  SonarPulse,
  SoundWave,
  WaveLine,
} from "./effects-rhythm";
import {
  ConfettiRain,
  CurtainWipe,
  HeroStack,
  MorphButton,
  OutroSequence,
  SharedElement,
  SpotlightStage,
  StaggerGrid,
  TimelineScrub,
  WipeTransition,
} from "./effects-stage";
import {
  DragCard,
  MagneticButton,
  ShuffleGrid,
} from "./effects-physics";
import { ScrollDepth, ShimmerBorder, TiltCard } from "./effects-light";
import { CharRevealDemo, OdometerDemo, StreamTyper } from "./effects-type";
import { BarGrowDemo, ListCollapseDemo, SparklineDemo, TabSlideDemo } from "./effects-data";
import { LoadingMorphDemo, RippleDemo, ShakeDemo, SkeletonSwap } from "./effects-feedback";

export interface LabItem {
  name: string;
  note: string;
  node: ReactNode;
  height?: number;
  bare?: boolean;
}

export interface LabGroup {
  index: string;
  title: string;
  desc: string;
  items: LabItem[];
}

export const LAB_GROUPS: LabGroup[] = [
  {
    index: "01",
    title: "液体与材质",
    desc: "表面张力、形变、溅射——让界面有「物质感」",
    items: [
      { name: "Gooey 磁吸水滴", note: "三层不同刚度的 spring 叠加 + SVG alpha 融合滤镜。靠近时粘连、拉开时拉丝断裂。", node: <GooeyBlobs /> },
      { name: "液态形变加载器", note: "不规则 border-radius 关键帧 + 缓慢自转 + 高光。比转圈图标更能表达「正在酝酿」。", node: <LiquidLoader /> },
      { name: "水滴分溅 2.0", note: "主溅射落地后 130ms 补一发偏移的二次溅射，模拟真实液体的二次飞溅。", node: <SplashStage /> },
      { name: "液体拖尾", note: "五颗刚度递减的小球串在光标后。用刚度而不是延迟，快速移动时才不会断成一节一节。", node: <LiquidTrail /> },
      { name: "涟漪池", note: "点哪里就在哪里长出水纹，每一下带主波 + 两发延迟副波。", node: <RipplePond /> },
      { name: "熔岩灯", note: "形变走 transform、对流走 translate，两条动画各管一条属性，互不覆盖。", node: <LavaLamp /> },
      { name: "水银珠", note: "两层 radial-gradient 拼出金属质感，hover 时压扁回弹——表面张力就是这一下。", node: <MercuryDrop /> },
      { name: "玻璃拟态", note: "拟物成立的前提是「背后有东西在动」；这里背后放极光，前景 backdrop-blur 吃掉细节。", node: <GlassPanel /> },
      { name: "磨砂融化", note: "hover 时模糊半径与不透明度同步回落，像冰面化开。", node: <FrostMelt /> },
      { name: "墨水扩散", note: "feTurbulence + feDisplacementMap 让边缘毛糙；scale 涨得慢、opacity 掉得快。", node: <InkBloom /> },
    ],
  },
  {
    index: "02",
    title: "物理与运动",
    desc: "刚度、阻尼、惯性——手感来自于参数而不是关键帧",
    items: [
      { name: "弹簧拖拽甩卡", note: "松手按甩出速度做惯性回弹（bounceStiffness 330 / damping 15），并即时显示速度。", node: <DragCard /> },
      { name: "磁力按钮", note: "光标进入 150px 引力场后按钮被牵引，内部文字再乘 0.35 形成视差——磁铁与被吸附物的错位。", node: <MagneticButton /> },
      { name: "布局洗牌（FLIP）", note: "只改数据顺序，位置补间交给 layout。列表筛选、看板拖拽、排序都能直接复用。", node: <ShuffleGrid /> },
      { name: "弹簧链", note: "五颗球刚度递减串在光标后，球间画虚线。每颗球的 spring 由自定义 hook 创建，不写在 map 里。", node: <SpringChain /> },
      { name: "单摆", note: "整段交给 CSS，transform-origin 在顶端；用非线性关键帧近似 sin 的加速与减速。", node: <PendulumSwing /> },
      { name: "自由落体", note: "下落加速 + 触地压扁 + 回弹三段串行。没有压扁的落地像纸片，有压扁才有质量。", node: <FreeFall /> },
      { name: "惯性抛掷", note: "松手后按甩出速度继续飞，被边界挡回来；速度数值实时显示，便于调参。", node: <InertiaToss /> },
      { name: "橡皮筋", note: "越往边界外拉阻力越大（dragElastic 0.12），并把拖动量映射成 scaleX，视觉上也被拽住。", node: <RubberBand /> },
      { name: "降落伞", note: "同样的拖拽，把阻尼调到很高就变成「被空气托着」——timeConstant 420ms 是关键。", node: <Parachute /> },
      { name: "抛接物", note: "x 匀速、y 先上后下，两条轨道分别插值，就是最省事的抛射近似。", node: <TossCatch /> },
    ],
  },
  {
    index: "03",
    title: "光影与纵深",
    desc: "视角、光源、景深——让平面产生厚度",
    items: [
      { name: "3D 倾斜卡", note: "perspective + 双轴旋转跟随光标，内容按 translateZ 分层，高光贴在卡面上（mix-blend-overlay）。", height: 240, node: <TiltCard /> },
      { name: "流光描边 + 光标聚光", note: "conic-gradient 在 1px 边框槽里旋转，面板内另有一团跟随光标的聚光；两层光不同步才显得真实。", height: 240, node: <ShimmerBorder /> },
      { name: "滚动景深", note: "由容器自身的 scrollYProgress 驱动，越远的层移动越慢、越淡——视差必须挂在滚动进度上才不假。", height: 240, bare: true, node: <ScrollDepth /> },
      { name: "聚光灯", note: "一层跟着光标的 radial 遮罩把周围压暗，深色面板比浅色更能表现「一束光打下来」。", node: <Spotlight /> },
      { name: "多层视差", note: "三层按 0.2 / 0.5 / 1.0 的系数跟随光标；没有系数差异就没有纵深感。", node: <ParallaxLayers /> },
      { name: "全息箔", note: "hue-rotate 跟随光标与中心的夹角，彩虹只在斜看时才出现——垂直看反而无趣。", node: <HoloFoil /> },
      { name: "阴影抬升", note: "位移只有 4px，距离感主要来自阴影同时变深变远；位移大了就成了飘。", node: <ShadowLift /> },
      { name: "光芒射线", note: "conic-gradient 的硬边条纹 24s 转一圈，配 radial 遮罩让中心留白。", node: <RayBurst /> },
      { name: "镜头光晕", note: "主光斑 + 一颗鬼影，全部跟着光标但系数不同，才像镜头里的折射而不是贴图。", node: <LensFlare /> },
      { name: "霓虹闪烁", note: "用 steps 卡掉插值，得到灯管刚通电那几下不稳；之后稳定发光。", node: <NeonFlicker /> },
    ],
  },
  {
    index: "04",
    title: "文字与数据",
    desc: "逐字、逐位、逐帧——让「内容在变」这件事可追踪",
    items: [
      { name: "逐字 3D 翻入", note: "每个字绕底边翻 92° 落下，父层必给 perspective，否则只是把字压扁。", node: <CharRevealDemo /> },
      { name: "里程表数字", note: "每一位是一条 0–9 竖条，改数字就是平移它。能看清「是哪一位在进位」。", node: <OdometerDemo /> },
      { name: "流式打字 + 声纹", note: "打字时光标闪动、声纹跳动；打完后声纹落回静止。", node: <StreamTyper /> },
      { name: "乱码解码", note: "每一位按自己的「锁定帧」依次落定，形成从左到右的扫描感。", node: <ScrambleText /> },
      { name: "打字机故障", note: "打字时偶尔用 clip-path 切条抽动，像信号不稳；不切条就只是慢。", node: <GlitchTyper /> },
      { name: "跑马灯", note: "内容复制两份，位移 50% 后无缝接上——少一份就会出现空档。", node: <Marquee /> },
      { name: "环形计数", note: "stroke-dashoffset 从整圈缩到目标比例，比「数字跳一下」更有进度感。", node: <CountRing /> },
      { name: "单词翻牌", note: "整词绕底边翻 90°，一组词依次落下，比逐字更像「翻牌」。", node: <WordFlip /> },
      { name: "字符波浪", note: "每个字一个 animation-delay，波从左走到右；用 CSS 而不是 framer 的 repeat。", node: <CharWave /> },
      { name: "滚动行情", note: "竖向无缝循环：内容复制两份，位移 -50% 即回到起点。", node: <QuoteTicker /> },
    ],
  },
  {
    index: "05",
    title: "反馈与状态",
    desc: "波纹、形变、抖动——回答「我这一下，系统收到了吗」",
    items: [
      { name: "点击波纹", note: "以按下点为圆心扩散水膜，而不是从元素中心。颜色取 currentColor，主/次按钮自动适配。", node: <RippleDemo /> },
      { name: "按钮加载形变", note: "文字让位给「环 + 执行中」，靠 layout 让按钮宽度真的收放，最后整块转成成功色。", node: <LoadingMorphDemo /> },
      { name: "表单错误抖动", note: "横向衰减摆动 7px，只给「出错了」这一件事。连点同一条错误也会再抖一次。", node: <ShakeDemo /> },
      { name: "骨架交接", note: "扫光骨架 → 真实内容交叉淡入。骨架宽度刻意做阶梯，比等宽更像真实文字。", node: <SkeletonSwap /> },
      { name: "成功迸发", note: "勾先画出，再炸出一圈彩屑——先确认，再庆祝，顺序不能反。", node: <SuccessBurst /> },
      { name: "错误卡片", note: "边框先红、再抖，最后常驻红晕。三个层次表达同一件事，而不是同时全上。", node: <ErrorCard /> },
      { name: "勾选弹跳", note: "勾自己画出来（pathLength），外框同时弹一下；两个动作同源但不同速。", node: <CheckPop /> },
      { name: "昼夜开关", note: "滑块过去之后图标跟着换——「状态迁移」比「状态翻转」更好懂。", node: <DayNightSwitch /> },
      { name: "步骤进度", note: "连接线按比例填充，只有当前步放大；标签全程不闪，避免变成走马灯。", node: <StepProgress /> },
      { name: "上传进度", note: "进度条与已传字节双轨推进，比一个百分比数字更「有过程」。", node: <UploadProgress /> },
    ],
  },
  {
    index: "06",
    title: "数据与结构",
    desc: "描边、生长、塌陷——让「数据的形状在变」有方向",
    items: [
      { name: "折线自绘", note: "pathLength 0→1 描边自绘，新数据点用 d 补间推进。比整条重画更连续。", node: <SparklineDemo /> },
      { name: "柱状生长", note: "从底部长出（scaleY + origin-bottom），逐根错峰 60ms；悬停时当根再长高一截并显示数值。", node: <BarGrowDemo /> },
      { name: "删除塌陷", note: "被删的行向左飞走并塌掉高度，其余行用 layout 平滑补位——因果闭合，列表不会「跳」。", node: <ListCollapseDemo /> },
      { name: "滑移指示器", note: "一条 layoutId 胶囊在互斥标签间滑动，同时驱动下方数据重播。位置关系就是心智模型。", node: <TabSlideDemo /> },
      { name: "环形图", note: "四段弧依次画出，累计偏移让它们天然拼成一个圆，不需要手算每段起点。", node: <DonutChart /> },
      { name: "仪表盘", note: "指针用 spring 打到目标角度，过冲一点点再稳住（阻尼调低就有）。", node: <GaugeMeter /> },
      { name: "热力图", note: "格子按对角线错峰淡入，hover 时单格放大并显值；错峰方向就是阅读方向。", node: <HeatmapGrid /> },
      { name: "树图生长", note: "外块先落位、内块随后展开，模拟「先分桶再装数据」。", node: <TreemapGrow /> },
      { name: "表格排序 FLIP", note: "点表头切换升降序，行位置全部交给 layout 补间，一行代码都不用写动画。", node: <SortFlip /> },
      { name: "KPI 翻牌", note: "每位数字绕底边翻一下，比整体淡入更能看出「是哪一位在变」。", node: <KpiFlip /> },
    ],
  },
  {
    index: "07",
    title: "空间与变换",
    desc: "翻转、堆叠、立方体——把平面变成有体积的容器",
    items: [
      { name: "翻转卡", note: "绕 Y 轴翻 180°，反面必须 backface-visibility:hidden，否则字是反的。", node: <FlipCard /> },
      { name: "立方体", note: "六个面各自 translateZ 到半径上；外层自转、内层翻滚，两条 CSS 动画各管一个轴。", node: <CubeSpin /> },
      { name: "封面流", note: "中间正对、两侧 rotateY 后退；绝对定位的子元素必须给容器定尺寸。", node: <Coverflow /> },
      { name: "发牌", note: "点一下把顶牌发走、其余补位——发牌是一个「队列出队」的过程。", node: <DealDeck /> },
      { name: "折页", note: "两半绕中缝翻开，originX 分别设在左右边缘。", node: <FoldPanels /> },
      { name: "开门", note: "门扇绕左边 swing 开，内容在门后淡入；顺序决定「里面有什么」的揭示感。", node: <DoorOpen /> },
      { name: "圆柱滚动", note: "每项按 40° 分布在圆周上并 translateZ，转容器就是滚圆柱。", node: <CylinderScroll /> },
      { name: "螺旋", note: "每项 rotateX 累加 60° 并逐级外扩，形成静态三维螺旋。", node: <HelixTower /> },
      { name: "透视网格", note: "整块 rotateX 58° 铺成地板，hover 的单格 translateZ 抬起来。", node: <PerspectiveGrid /> },
      { name: "翻页时钟", note: "上半页翻下去、下半页翻上来，合起来才是一次翻页；用 key 触发重挂载。", node: <FlipClock /> },
    ],
  },
  {
    index: "08",
    title: "手势与触控",
    desc: "滑动、长按、捏合——动画不是播出来的，是被手拽出来的",
    items: [
      { name: "滑动删除", note: "拖过 96px 才飞出去，否则弹回。阈值要「过半才触发」，避免误删。", node: <SwipeDismiss /> },
      { name: "长按进度", note: "按住时环形进度填充，松手即断；填满才触发，是防误触的标准做法。", node: <LongPress /> },
      { name: "拖拽排序", note: "Reorder 自己处理位置补间，只要保证 key 稳定。", node: <DragReorder /> },
      { name: "下拉刷新", note: "下拉超过 56px 后松手才刷新，否则弹回——阈值和「意外滚动」拉开。", node: <PullRefresh /> },
      { name: "滑动显隐", note: "左滑露出操作，滑过中点自动展开到固定位置，不全靠手停在哪。", node: <SwipeReveal /> },
      { name: "双击放大", note: "250ms 内第二次点击才算双击，且以点击点为缩放中心。", node: <DoubleTapZoom /> },
      { name: "捏合缩放", note: "两根指针的距离直接映射到缩放比；用 pointerId 区分主次指针。", node: <PinchZoom /> },
      { name: "甩动惯性", note: "自己算速度与摩擦（每帧衰减 8%），比 dragMomentum 更能体现「甩」的力度。", node: <FlingCard /> },
      { name: "擦除揭示", note: "手指划过的地方擦掉遮罩，像在用橡皮擦开雾玻璃。", node: <ScrubReveal /> },
      { name: "边缘回弹光", note: "滚到边界时边缘亮一下——桌面端没有橡皮筋手感，但「我到底了」必须给。", bare: true, node: <OverscrollGlow /> },
    ],
  },
  {
    index: "09",
    title: "节奏与韵律",
    desc: "把「时间」变成可见的节拍",
    items: [
      { name: "声纹", note: "九根柱子错峰跳动，用 scaleY 而不是 height，保证跑在合成线程。", node: <SoundWave /> },
      { name: "均衡器", note: "低频长、高频短，延迟按频段分组——像真的在分频，而不是整齐划一。", node: <Equalizer /> },
      { name: "节拍脉冲", note: "一秒两拍，第一下重、第二下轻；重音在前才是鼓点。", node: <BeatPulse /> },
      { name: "声纳", note: "两层环错开 1.4s，形成后浪推前浪；周期必须错开，同步就成了呼吸。", node: <SonarPulse /> },
      { name: "雷达扫描", note: "conic 扇形旋转，上面的光点按自己的周期闪烁，两层节奏互不干扰。", node: <RadarSweep /> },
      { name: "心跳", note: "双跳（咚-哒），第二下明显弱于第一下；单跳不像心脏。", node: <Heartbeat /> },
      { name: "呼吸球", note: "box-shadow 的扩散范围跟着缩放一起动，光才像在「呼吸」。", node: <BreathingOrb /> },
      { name: "脉冲线", note: "dash 偏移让一段亮线沿心电图样条跑，比整条线闪烁更克制。", node: <PulseLine /> },
      { name: "倒计时", note: "数字翻页而不是淡入淡出——时间在走，就该一页一页翻。", node: <Countdown /> },
      { name: "波浪线", note: "整条正弦曲线横移，两端用遮罩淡出，避免「切一刀」的硬边。", node: <WaveLine /> },
    ],
  },
  {
    index: "10",
    title: "编排与转场",
    desc: "多个元素按时间轴协同——动效的「导演层」",
    items: [
      { name: "英雄堆叠", note: "标题 → 副标题 → 主操作，按视线落点依次进入，间隔 90ms。", node: <HeroStack /> },
      { name: "交错网格", note: "入场用 stagger、hover 用 spring；两种节奏不要混在一条 transition 里。", node: <StaggerGrid /> },
      { name: "时间轴擦洗", note: "拖动滑块直接驱动一段编排的进度，用来逐帧检查动效。", node: <TimelineScrub /> },
      { name: "幕布", note: "两半向两边拉开，后面的内容先暗后亮——顺序即「揭晓」。", node: <CurtainWipe /> },
      { name: "形态过渡", note: "按钮长成卡片，layout 负责补间，内容用 AnimatePresence 交接。", node: <MorphButton /> },
      { name: "共享元素", note: "缩略图与大图共用 layoutId，浏览器自动补间中间帧。", node: <SharedElement /> },
      { name: "彩带", note: "每片有自己的横向漂移与旋转，落点随机才不会像同一条传送带。", node: <ConfettiRain /> },
      { name: "擦除转场", note: "新内容被一道竖线「擦」出来，比淡入更有「翻篇」的意思。", node: <WipeTransition /> },
      { name: "聚光舞台", note: "一盏灯在台上左右扫，照到哪个区块哪个区块才亮。", node: <SpotlightStage /> },
      { name: "收尾序列", note: "四步依次打勾，最后落一个完成态——把「过程」演给用户看。", node: <OutroSequence /> },
    ],
  },
  {
    index: "11",
    title: "微交互 · 手感",
    desc: "小到不会被人点名，但缺了就会觉得「这产品糙」",
    items: [
      { name: "黏稠回弹", note: "拖出去越远橡皮筋拉力越大，松手后过冲一下再回位。", node: <ViscousBlob /> },
      { name: "弹跳球", note: "CSS 做抛物线位移，落地点放一个同步压扁的影子——影子缩放就是高度提示。", node: <BouncingBall /> },
      { name: "链条甩动", note: "SVG 路径描边自绘 + 末端光点延迟弹出，像鞭子抽过去。", node: <WhipLash /> },
      { name: "陀螺", note: "快转 + 轻微摆动；停下来之前轴心会画圈，靠的是 wobble 而不是改速度。", node: <SpinningTop /> },
      { name: "气泡上升", note: "translateY 负责上升，气泡本体用 border 做成空心，才不像实心球。", node: <BubbleRise /> },
      { name: "表面张力滴落", note: "先被拉长成水滴形，再断开下落；border-radius 的非对称值就是张力在拉尖。", node: <TensionDrop /> },
      { name: "文字扫光", note: "background-clip:text + 一条斜向高光，比 box-shadow 干净得多。", node: <TextShine /> },
      { name: "渐变标题", note: "色带在文字里循环流动，只给标题级文字用，正文会读不清。", node: <GradientTitle /> },
      { name: "棱镜散射", note: "一束白光进去，三束彩光依次偏折；错峰 60ms 是「折射有时间差」。", node: <PrismSplit /> },
      { name: "文字变形", note: "两个词交叉淡入，各自带模糊与位移，避免硬切换。", node: <WordMorph /> },
    ],
  },
  {
    index: "12",
    title: "微交互 · 组件",
    desc: "直接来自真实组件的动效，可原样搬进业务代码",
    items: [
      { name: "离线重试", note: "退避间隔逐次变长（1s→2s→4s），并把「第几次」明说出来，别让用户猜。", node: <OfflineRetry /> },
      { name: "空态呼吸", note: "一个光圈极慢地明暗，传达「这里是活的，只是在等你」。", node: <EmptyBreathe /> },
      { name: "分段进度环", note: "conic-gradient 的硬边扇区扫过去，表示「在巡检」而不是「在加载」。", node: <SegmentRing /> },
      { name: "分页滑动", note: "换页时新内容从右推入、旧内容左移退场，方向即「往后翻」。", node: <PageSlide /> },
      { name: "卡片堆叠", note: "悬停时扇形展开，每张牌旋转角递增；收起时是一摞，展开才可读。", node: <CardStack /> },
      { name: "时间轴", note: "竖线自上而下「长」出来，节点在线到达时才弹出。", node: <TimelineDraw /> },
      { name: "树展开", note: "高度从 0 长到 auto，子项错峰跟上；折叠时顺序反过来。", node: <TreeExpand /> },
      { name: "逐字消散", note: "悬停时每个字向不同方向飘走，离开时归位；stagger 反向。", node: <DisperseText /> },
      { name: "打字光标", note: "光标本身也是一个「角色」——它在等，说明系统也在等。", node: <CaretBlink /> },
      { name: "徽标角标", note: "数字变化时角标弹一下，旧数字向上翻走；「有新东西」要看得见。", node: <BadgePop /> },
    ],
  },
];

/** 效果总数：页头数量、导航角标都从这里取，杜绝「改了内容忘了改数字」 */
export const LAB_TOTAL = LAB_GROUPS.reduce((sum, group) => sum + group.items.length, 0);
