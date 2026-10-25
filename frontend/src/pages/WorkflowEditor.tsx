/**
 * 工作流画布：可视化编排的落地实现。
 *
 * 为什么自己写画布而不引 React Flow：
 * - 后端 `graph_definition` 已经是 React Flow 风格的 nodes/edges，数据结构够简单；
 * - 真正需要的能力只有「拖拽 + 连线 + 选中」，引一个 400KB 的库反而要迁就它的
 *   受控/非受控状态模型；
 * - 自绘对新版 SVG 边、动效（水滴分溅反馈）掌控力更强。
 *
 * 交互约定（与常见编排器一致，降低学习成本）：
 * - 拖节点头部移动；
 * - 点节点右侧圆点进入连线态，再点目标节点完成连线（点空白处取消）；
 * - 选中节点后在右侧检查器里改名/删除；
 * - 画布改动只落在本地状态，点「保存编排」才写回后端——避免误拖就落库。
 *
 * 校验前置：保存前先在本地跑一遍结构校验（必须有路由、必须可达、默认 Agent 必须存在），
 * 把问题在画布上指出来，而不是等后端返回 422 让用户猜。
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { agentsApi, workflowsApi } from "../lib/api";
import { useAsync, useSubmit } from "../lib/hooks";
import { EASE, listContainer, softSpring } from "../lib/motion";
import { DropletSplash, AuroraField, FadeSwap, Reveal, riseItem } from "../components/motion";
import { useWorkspace } from "../state/workspace";
import {
  Button,
  Card,
  CardHeader,
  Empty,
  ErrorNote,
  Field,
  Input,
  Select,
  Skeleton,
  StatusTag,
  Switch,
  taskTone,
  useToast,
} from "../components/ui";
import {
  IconArrowRight,
  IconAgent,
  IconClose,
  IconGraph,
  IconHistory,
  IconPlus,
  IconRocket,
  IconSave,
  IconTrash,
} from "../components/icons";
import type { Agent, GraphDefinition, GraphNode, WorkflowVersion } from "../lib/types";

const NODE_W = 196;
const NODE_H = 64;
const CANVAS_W = 1180;
const CANVAS_H = 720;

interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

/** 结构校验：错误会阻断保存，警告只提示 */
function validate(graph: GraphDefinition, agents: Agent[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const agentNodes = graph.nodes.filter((n) => n.type === "agent");

  if (!graph.nodes.some((n) => n.type === "router")) {
    issues.push({ level: "error", message: "缺少路由节点：必须有一个 router 才能分发请求" });
  }
  if (agentNodes.length === 0) {
    issues.push({ level: "error", message: "至少需要一个 Agent 节点" });
  }
  if (graph.default_agent && !byId.has(graph.default_agent)) {
    issues.push({ level: "error", message: "默认 Agent 指向了不存在的节点" });
  }
  if (!graph.default_agent && agentNodes.length > 0) {
    issues.push({ level: "warning", message: "未指定默认 Agent：路由全未命中时会退化为第一个 Agent" });
  }
  // 可达性：没有入边的 Agent 永远不会被执行
  const inbound = new Set(graph.edges.map((e) => e.target));
  for (const node of agentNodes) {
    if (!inbound.has(node.id) && graph.nodes.length > 1) {
      issues.push({ level: "warning", message: `节点「${node.label}」没有入边，不会被路由到` });
    }
  }
  // 引用了已删除的 Agent
  const knownAgents = new Set(agents.map((a) => a.id));
  for (const node of agentNodes) {
    if (node.id !== "router" && !knownAgents.has(node.id)) {
      issues.push({
        level: "warning",
        message: `节点「${node.label}」对应的 Agent 已被删除，执行时会被跳过`,
      });
    }
  }
  return issues;
}

/** 三次贝塞尔：横向出、横向入，视觉上更符合「数据从左往右流」 */
function edgePath(from: GraphNode, to: GraphNode): string {
  const x1 = from.position.x + NODE_W;
  const y1 = from.position.y + NODE_H / 2;
  const x2 = to.position.x;
  const y2 = to.position.y + NODE_H / 2;
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/**
 * 把同一条贝塞尔离散成采样点。
 *
 * 为什么不用 SVG 的 animateMotion：它只能挂 `<animateMotion>` 子元素，
 * 拿不到 framer 的编排（延迟、缓动、与其它动画同步）。
 * 采样成 26 个点后，`motion.circle` 的 cx/cy 走关键帧，效果一样且可控。
 */
function edgeSamples(from: GraphNode, to: GraphNode, steps = 26): { cx: number[]; cy: number[] } {
  const x1 = from.position.x + NODE_W;
  const y1 = from.position.y + NODE_H / 2;
  const x2 = to.position.x;
  const y2 = to.position.y + NODE_H / 2;
  const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
  const cx: number[] = [];
  const cy: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    cx.push(
      mt ** 3 * x1 + 3 * mt ** 2 * t * (x1 + dx) + 3 * mt * t ** 2 * (x2 - dx) + t ** 3 * x2,
    );
    cy.push(mt ** 3 * y1 + 3 * mt ** 2 * t * y1 + 3 * mt * t ** 2 * y2 + t ** 3 * y2);
  }
  return { cx, cy };
}

export function WorkflowEditorPage() {
  const { wfId = "" } = useParams();
  const { app } = useWorkspace();
  const appId = app?.id ?? "";
  const toast = useToast();
  const navigate = useNavigate();
  const { pending, run } = useSubmit();
  // SVG 属性动画不受 MotionConfig 的 reducedMotion 管辖，这里单独判断
  const reduceMotion = useReducedMotion();

  const flows = useAsync(() => workflowsApi.list(appId), [appId], { enabled: Boolean(appId) });
  const flow = (flows.data ?? []).find((f) => f.id === wfId) ?? null;

  const graphState = useAsync(() => workflowsApi.getGraph(appId, wfId), [appId, wfId], {
    enabled: Boolean(appId && wfId),
  });
  const agents = useAsync(() => agentsApi.list(appId), [appId], { enabled: Boolean(appId) });
  const versions = useAsync(() => workflowsApi.versions(appId, wfId), [appId, wfId], {
    enabled: Boolean(appId && wfId),
  });

  const [graph, setGraph] = useState<GraphDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);

  // 首次加载与「重新拉取」时同步到本地编辑态
  useEffect(() => {
    if (graphState.data) {
      setGraph(graphState.data);
      setDirty(false);
    }
  }, [graphState.data]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  /**
   * 水滴反馈：只在「发生了一件事」的时刻出现（新建节点 / 连线成功 / 发布版本）。
   * 一次只留一个，新的直接顶掉旧的——避免连环操作时画布上堆满特效。
   */
  const [splash, setSplash] = useState<{
    x: number;
    y: number;
    key: number;
    tone: "brand" | "success";
  } | null>(null);

  const fireSplash = (x: number, y: number, tone: "brand" | "success" = "brand") => {
    setSplash({ x, y, key: Date.now(), tone });
  };

  /**
   * 「数据流」：每自增一次，就沿每条边重放一轮光点。
   * 这比单纯弹个 toast 更有信息量——它直观说明「请求会这样流过去」。
   *
   * 为什么用自增的 key 而不是常驻循环动画：常驻循环会让人误以为画布在跑流量，
   * 而这里要表达的是「刚才那一下会发生什么」。放完就归零、卸载。
   */
  const [pulse, setPulse] = useState(0);
  const flowTimer = useRef<number | null>(null);

  const playFlow = useCallback(() => {
    setPulse((n) => n + 1);
    if (flowTimer.current) window.clearTimeout(flowTimer.current);
    flowTimer.current = window.setTimeout(() => setPulse(0), 2400);
  }, []);

  useEffect(
    () => () => {
      if (flowTimer.current) window.clearTimeout(flowTimer.current);
    },
    [],
  );

  // 首次进入画布时放一遍数据流：不用点任何按钮，也能一眼看懂「谁会流向谁」
  const introRef = useRef(false);
  useEffect(() => {
    if (!graph || introRef.current || graph.edges.length === 0) return;
    introRef.current = true;
    playFlow();
  }, [graph, playFlow]);

  const issues = useMemo(
    () => (graph ? validate(graph, agents.data ?? []) : []),
    [agents.data, graph],
  );
  const hasError = issues.some((i) => i.level === "error");

  const update = useCallback((next: Partial<GraphDefinition>) => {
    setGraph((prev) => (prev ? { ...prev, ...next } : prev));
    setDirty(true);
  }, []);

  /* ------------------------------------------------------------ 拖拽 */

  const onNodePointerDown = (event: React.PointerEvent, node: GraphNode) => {
    // 端口与按钮不触发拖拽
    if ((event.target as HTMLElement).dataset.port === "1") return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      id: node.id,
      offsetX: event.clientX - rect.left - node.position.x,
      offsetY: event.clientY - rect.top - node.position.y,
    };
    setSelectedId(node.id);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const x = Math.max(0, Math.min(CANVAS_W - NODE_W, event.clientX - rect.left - drag.offsetX));
    const y = Math.max(0, Math.min(CANVAS_H - NODE_H, event.clientY - rect.top - drag.offsetY));
    setGraph((prev) =>
      prev
        ? {
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.id === drag.id ? { ...n, position: { x: Math.round(x), y: Math.round(y) } } : n,
            ),
          }
        : prev,
    );
    setDirty(true);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  /* ------------------------------------------------------------ 连线 */

  const addAgentNode = (agent: Agent) => {
    if (!graph) return;
    if (graph.nodes.some((n) => n.id === agent.id)) {
      toast.push("该 Agent 已在画布中", "info");
      return;
    }
    const index = graph.nodes.filter((n) => n.type === "agent").length;
    const node: GraphNode = {
      id: agent.id,
      type: "agent",
      label: agent.name,
      position: { x: 400, y: 80 + index * 140 },
    };
    update({ nodes: [...graph.nodes, node] });
    fireSplash(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2);
  };

  const addRouterNode = () => {
    if (!graph) return;
    if (graph.nodes.some((n) => n.type === "router")) {
      toast.push("画布中已有路由节点", "info");
      return;
    }
    update({
      nodes: [
        ...graph.nodes,
        { id: "router", type: "router", label: "智能路由", position: { x: 80, y: 220 } },
      ],
    });
    fireSplash(80 + NODE_W / 2, 220 + NODE_H / 2);
  };

  const completeLink = (targetId: string) => {
    if (!graph || !linkingFrom || linkingFrom === targetId) {
      setLinkingFrom(null);
      return;
    }
    const exists = graph.edges.some(
      (e) => e.source === linkingFrom && e.target === targetId,
    );
    if (exists) {
      toast.push("这条连线已存在", "info");
      setLinkingFrom(null);
      return;
    }
    const target = graph.nodes.find((n) => n.id === targetId);
    update({
      edges: [...graph.edges, { source: linkingFrom, target: targetId, label: target?.label }],
    });
    if (target) {
      // 连线成功的落点给在「目标节点」上：水花在哪里，注意力就落在哪里
      fireSplash(target.position.x + NODE_W / 2, target.position.y + NODE_H / 2);
    }
    // 刚连好的这条边走一遍光点，等于当场演示一次「请求会怎么流」
    playFlow();
    setLinkingFrom(null);
  };

  const removeNode = (nodeId: string) => {
    if (!graph) return;
    update({
      nodes: graph.nodes.filter((n) => n.id !== nodeId),
      edges: graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      default_agent: graph.default_agent === nodeId ? null : graph.default_agent,
    });
    setSelectedId(null);
  };

  const removeEdge = (source: string, target: string) => {
    if (!graph) return;
    update({ edges: graph.edges.filter((e) => !(e.source === source && e.target === target)) });
  };

  /* ------------------------------------------------------------ 动作 */

  const save = async () => {
    if (!graph) return;
    if (hasError) {
      toast.push("请先修正校验错误", "error");
      return;
    }
    try {
      await run(async () => {
        await workflowsApi.saveGraph(appId, wfId, graph);
      });
      toast.push("编排已保存");
      setDirty(false);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "保存失败", "error");
    }
  };

  const publish = async () => {
    if (!graph) return;
    if (dirty) {
      toast.push("请先保存编排，再发布版本", "error");
      return;
    }
    try {
      const changelog = window.prompt("填写版本说明（可留空）") ?? "";
      const version = await workflowsApi.createVersion(appId, wfId, changelog);
      await workflowsApi.release(appId, wfId, version.id);
      toast.push(`已发布 v${version.version}`);
      // 发布是整条链路里最重的动作，水花给在画布中央而不是按钮上
      fireSplash(CANVAS_W / 2, CANVAS_H / 2, "success");
      // 紧跟着走一遍数据流：先「落下」，再「流过去」，两拍比一拍更有分量
      playFlow();
      await versions.reload();
      await flows.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "发布失败", "error");
    }
  };

  const rollback = async (version: WorkflowVersion) => {
    try {
      await workflowsApi.rollback(appId, wfId, version.id);
      toast.push(`已回滚到 v${version.version}`);
      await versions.reload();
      await graphState.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "回滚失败", "error");
    }
  };

  const selected = graph?.nodes.find((n) => n.id === selectedId) ?? null;
  const loading = graphState.loading || flows.loading;

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    );
  }

  if (!graph) {
    return (
      <Empty
        title="工作流不存在"
        description="可能已被删除，或当前应用下没有这个工作流。"
        action={
          <Link to="/workflows" className="text-caption text-brand-600 hover:underline">
            返回列表
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/workflows"
            className="flex h-7 w-7 items-center justify-center rounded-control border border-line-base text-ink-secondary hover:border-brand-400 hover:text-brand-600"
            aria-label="返回工作流列表"
          >
            ←
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-title text-ink-primary">{flow?.name ?? "工作流"}</h1>
            <div className="mt-0.5 flex items-center gap-2 text-caption text-ink-tertiary">
              <span>{graph.nodes.length} 个节点</span>
              <span>·</span>
              <span>{graph.edges.length} 条连线</span>
              {dirty && <StatusTag tone="warning">有未保存修改</StatusTag>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            icon={<IconArrowRight size={14} />}
            onClick={() => navigate("/playground")}
          >
            去试跑
          </Button>
          <Button icon={<IconRocket size={14} />} onClick={() => void publish()}>
            发布版本
          </Button>
          <Button
            variant="primary"
            icon={<IconSave size={14} />}
            loading={pending}
            onClick={() => void save()}
          >
            保存编排
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---------------------------------------------------- 画布 */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line-split px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="dashed"
                icon={<IconPlus size={12} />}
                onClick={addRouterNode}
              >
                路由节点
              </Button>
              <Select
                className="h-7 w-[180px] text-caption"
                value=""
                onChange={(e) => {
                  const agent = (agents.data ?? []).find((a) => a.id === e.target.value);
                  if (agent) addAgentNode(agent);
                }}
              >
                <option value="">+ 添加 Agent 节点</option>
                {(agents.data ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="text-caption text-ink-tertiary">
              {/* 连线提示随状态淡入淡出：原地换字会「跳」，淡出淡入把「进入连线态」变得可感知 */}
              <FadeSwap id={linkingFrom ?? "idle"}>
                {linkingFrom
                  ? "连线中：点击目标节点完成，点空白处取消"
                  : "拖动节点可移动 · 点节点右侧圆点开始连线"}
              </FadeSwap>
            </div>
          </div>

          <div
            className="workflow-canvas scroll-slim relative overflow-auto"
            style={{ maxHeight: 620 }}
          >
            <div
              ref={canvasRef}
              className="canvas-grid relative"
              style={{ width: CANVAS_W, height: CANVAS_H }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={(e) => {
                // 点空白：取消连线 + 取消选中
                if (e.target === e.currentTarget) {
                  setLinkingFrom(null);
                  setSelectedId(null);
                }
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0"
                width={CANVAS_W}
                height={CANVAS_H}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#B995DC" />
                  </marker>
                </defs>
                {graph.edges.map((edge, index) => {
                  const from = graph.nodes.find((n) => n.id === edge.source);
                  const to = graph.nodes.find((n) => n.id === edge.target);
                  if (!from || !to) return null;
                  // 光点只在 playFlow 之后的一小段时间里存在；拖动节点时不会反复重播
                  const track = pulse > 0 && !reduceMotion ? edgeSamples(from, to) : null;
                  const startDelay = 0.12 + index * 0.1;
                  return (
                    <g key={`${edge.source}-${edge.target}`}>
                      <motion.path
                        d={edgePath(from, to)}
                        fill="none"
                        stroke="#B995DC"
                        strokeWidth={1.5}
                        markerEnd="url(#arrow)"
                        // 连线「画出来」而不是突然出现：路径自身生长，顺序感更强
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.42, ease: EASE, delay: 0.06 * index }}
                      />

                      {track && (
                        <>
                          {/* 光晕：让细线在浅底上也能看清「有什么东西过去了」 */}
                          <motion.circle
                            r={7}
                            fill="#7644A7"
                            initial={{ opacity: 0, cx: track.cx[0], cy: track.cy[0] }}
                            animate={{
                              cx: track.cx,
                              cy: track.cy,
                              opacity: [0, 0.18, 0.18, 0],
                            }}
                            transition={{
                              duration: 1.15,
                              ease: "linear",
                              delay: startDelay,
                            }}
                          />
                          <motion.circle
                            r={3}
                            fill="#7644A7"
                            initial={{ opacity: 0, cx: track.cx[0], cy: track.cy[0] }}
                            animate={{ cx: track.cx, cy: track.cy, opacity: [0, 1, 1, 0] }}
                            transition={{
                              duration: 1.15,
                              ease: "linear",
                              delay: startDelay,
                            }}
                          />
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>

              {graph.nodes.map((node) => {
                const isRouter = node.type === "router";
                const isSelected = node.id === selectedId;
                const isLinkTarget = linkingFrom && linkingFrom !== node.id;
                return (
                  <motion.div
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`节点 ${node.label}`}
                    onPointerDown={(e) => onNodePointerDown(e, node)}
                    onClick={() => (linkingFrom ? completeLink(node.id) : setSelectedId(node.id))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSelectedId(node.id);
                    }}
                    initial={{ opacity: 0, scale: 0.94, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    whileHover={{ scale: 1.012 }}
                    whileTap={{ scale: 0.994 }}
                    transition={softSpring}
                    className={
                      "absolute cursor-grab select-none rounded-card border bg-white shadow-card transition-shadow active:cursor-grabbing " +
                      (isSelected
                        ? "border-brand-500 ring-2 ring-brand-100"
                        : isLinkTarget
                          ? "border-brand-300 border-dashed"
                          : "border-line-base hover:border-brand-300")
                    }
                    style={{
                      left: node.position.x,
                      top: node.position.y,
                      width: NODE_W,
                      height: NODE_H,
                    }}
                  >
                    <div className="flex h-full items-center gap-2.5 px-3">
                      <span
                        className={
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-control " +
                          (isRouter ? "bg-brand-50 text-brand-600" : "bg-surface-fill text-ink-secondary")
                        }
                      >
                        {isRouter ? <IconGraph size={15} /> : <IconAgent size={15} />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-body text-ink-primary">{node.label}</div>
                        <div className="truncate text-caption text-ink-tertiary">
                          {isRouter ? `路由 · ${graph.router}` : "Agent"}
                        </div>
                      </div>
                    </div>

                    {/* 输入端口（左侧） */}
                    <span className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-line-base" />

                    {/* 输出端口（右侧）：点击进入连线态 */}
                    <button
                      type="button"
                      data-port="1"
                      aria-label={`从 ${node.label} 连线`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setLinkingFrom(linkingFrom === node.id ? null : node.id);
                      }}
                      className={
                        "absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white transition-transform hover:scale-125 " +
                        (linkingFrom === node.id ? "bg-brand-600" : "bg-brand-300")
                      }
                    />
                  </motion.div>
                );
              })}

              {/* 一次性的液体反馈：key 变了就重放，画完自己消失 */}
              {splash && (
                <DropletSplash
                  key={splash.key}
                  x={splash.x}
                  y={splash.y}
                  tone={splash.tone}
                  onDone={() => setSplash(null)}
                />
              )}

              {graph.nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                  {/* 空画布是唯一可以「放松」的地方：给一层缓慢流动的极光，避免死白 */}
                  <AuroraField className="opacity-90" />
                  <motion.div
                    className="relative max-w-sm text-center"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: EASE }}
                  >
                    <p className="text-body text-ink-secondary">画布是空的</p>
                    <p className="mt-1 text-caption text-ink-tertiary">
                      先添加「路由节点」，再把 Agent 拖进来并连线
                    </p>
                  </motion.div>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* ---------------------------------------------------- 检查器 */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="路由与运行参数" />
            <div className="space-y-4 px-4 py-4">
              <Field label="路由策略" hint="规则确定性强；语义更灵活；混合取二者之长">
                <Select
                  value={graph.router}
                  onChange={(e) => update({ router: e.target.value })}
                >
                  <option value="rule">规则路由（关键词）</option>
                  <option value="semantic">语义路由（模型分类）</option>
                  <option value="hybrid">混合（规则优先，未命中走语义）</option>
                </Select>
              </Field>

              <Field label="默认 Agent" hint="路由全部未命中时回落到它">
                <Select
                  value={graph.default_agent ?? ""}
                  onChange={(e) => update({ default_agent: e.target.value || null })}
                >
                  <option value="">未指定</option>
                  {graph.nodes
                    .filter((n) => n.type === "agent")
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.label}
                      </option>
                    ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="最大轮次">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={graph.max_iterations}
                    onChange={(e) => update({ max_iterations: Number(e.target.value) })}
                  />
                </Field>
                <Field label="置信度阈值">
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={graph.confidence_threshold}
                    onChange={(e) =>
                      update({ confidence_threshold: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between rounded-control bg-surface-fill px-3 py-2.5">
                <div>
                  <div className="text-body text-ink-primary">启用知识库检索</div>
                  <div className="text-caption text-ink-tertiary">关闭后 Agent 不注入 RAG 上下文</div>
                </div>
                <Switch
                  checked={graph.rag_enabled}
                  onChange={(next) => update({ rag_enabled: next })}
                  label="启用知识库检索"
                />
              </div>

              {/* 检索片段数随开关展开/收起：直接条件渲染会「闪」，高度动画把显隐变成过程 */}
              <Reveal show={graph.rag_enabled}>
                <Field label="检索片段数" hint="注入上下文的片段条数">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={graph.rag_top_k}
                    onChange={(e) => update({ rag_top_k: Number(e.target.value) })}
                  />
                </Field>
              </Reveal>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="校验"
              extra={
                issues.length === 0 ? (
                  <StatusTag tone="success">通过</StatusTag>
                ) : (
                  <StatusTag tone={hasError ? "error" : "warning"}>
                    {issues.length} 项
                  </StatusTag>
                )
              }
            />
            <div className="px-4 py-3">
              {issues.length === 0 ? (
                <p className="text-caption text-ink-tertiary">结构与连通性检查通过</p>
              ) : (
                <motion.ul
                  className="space-y-1.5"
                  variants={listContainer}
                  initial="initial"
                  animate="animate"
                >
                  {issues.map((issue) => (
                    <motion.li
                      key={issue.message}
                      variants={riseItem}
                      className={
                        "flex items-start gap-1.5 text-caption " +
                        (issue.level === "error" ? "text-[#CF1322]" : "text-[#D48806]")
                      }
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
                      {issue.message}
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </div>
          </Card>

          {/* 检查器：选中/切换节点时整块高度展开，取消选中时收起后卸载——
              直接条件渲染会「闪进闪出」，侧边栏的高度是连续的，动画刚好把连续性画出来 */}
          <AnimatePresence initial={false}>
            {selected && (
              <motion.div
                key={selected.id}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.26, ease: EASE }}
                className="overflow-hidden"
              >
                <Card>
                  <CardHeader
                    title="节点"
                    extra={
                      <button
                        type="button"
                        onClick={() => removeNode(selected.id)}
                        className="flex items-center gap-1 text-caption text-[#CF1322] hover:underline"
                      >
                        <IconTrash size={12} /> 删除
                      </button>
                    }
                  />
                  <div className="space-y-3 px-4 py-4">
                    <Field label="显示名称">
                      <Input
                        value={selected.label}
                        onChange={(e) =>
                          update({
                            nodes: graph.nodes.map((n) =>
                              n.id === selected.id ? { ...n, label: e.target.value } : n,
                            ),
                          })
                        }
                      />
                    </Field>
                    <div className="text-caption text-ink-tertiary">
                      类型：{selected.type} · 坐标：{selected.position.x}, {selected.position.y}
                    </div>
                    {graph.edges.filter((e) => e.source === selected.id || e.target === selected.id)
                      .length > 0 && (
                      <div>
                        <div className="mb-1.5 text-caption text-ink-secondary">连线</div>
                        <motion.ul
                          className="space-y-1"
                          variants={listContainer}
                          initial="initial"
                          animate="animate"
                        >
                          {graph.edges
                            .filter((e) => e.source === selected.id)
                            .map((edge) => {
                              const target = graph.nodes.find((n) => n.id === edge.target);
                              return (
                                <motion.li
                                  key={`out-${edge.target}`}
                                  variants={riseItem}
                                  className="flex items-center justify-between rounded-control bg-surface-fill px-2 py-1 text-caption"
                                >
                                  <span className="truncate text-ink-secondary">
                                    → {target?.label ?? edge.target}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label="删除连线"
                                    onClick={() => removeEdge(edge.source, edge.target)}
                                    className="text-ink-tertiary hover:text-[#CF1322]"
                                  >
                                    <IconClose size={12} />
                                  </button>
                                </motion.li>
                              );
                            })}
                        </motion.ul>
                      </div>
                    )}
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          <Card>
            <CardHeader
              title="版本"
              extra={
                <span className="flex items-center gap-1 text-caption text-ink-tertiary">
                  <IconHistory size={12} /> {versions.data?.length ?? 0} 个
                </span>
              }
            />
            <div className="px-4 py-3">
              {(versions.data ?? []).length === 0 ? (
                <p className="text-caption text-ink-tertiary">
                  还没有版本。保存编排后点「发布版本」生成首个快照。
                </p>
              ) : (
                <motion.ul
                  className="space-y-1.5"
                  variants={listContainer}
                  initial="initial"
                  animate="animate"
                >
                  {(versions.data ?? []).map((version) => (
                    <motion.li
                      key={version.id}
                      variants={riseItem}
                      className="flex items-center justify-between rounded-control bg-surface-fill px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-caption text-ink-primary">
                          v{version.version}
                          <StatusTag tone={taskTone(version.status)}>
                            {version.status === "released" ? "生效中" : "历史"}
                          </StatusTag>
                        </div>
                        <div className="truncate text-[11px] text-ink-tertiary">
                          {version.changelog || "无说明"}
                        </div>
                      </div>
                      {version.status !== "released" && (
                        <Button
                          size="sm"
                          variant="text"
                          onClick={() => void rollback(version)}
                        >
                          回滚
                        </Button>
                      )}
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      {graphState.error && (
        <div className="mt-4">
          <ErrorNote message={graphState.error} onRetry={() => void graphState.reload()} />
        </div>
      )}
    </div>
  );
}
