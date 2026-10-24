/**
 * 对话调试台：把一次请求的完整链路摊开给人看。
 *
 * 这是整个控制台最有价值的页面——它不只显示「回答了什么」，还显示：
 * - 路由决策（为什么交给这个 Agent、置信度多少、用了哪种策略）；
 * - RAG 命中了哪些片段、相似度多少；
 * - 隐藏返回（不展示给终端用户的结构化动作）；
 * - 终态与 token 消耗。
 *
 * 排障时这四件事决定了「是路由错了、检索错了、还是模型错了」，只看聊天内容无法区分。
 * token 走 SSE 增量渲染；同时保留「非流式」模式，方便对比两种路径的结果是否一致。
 */

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import { agentsApi, chatApi, streamChat } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { EASE, listContainer, listItem } from "../lib/motion";
import { useWorkspace } from "../state/workspace";
import { AuroraField, StreamCursor } from "../components/motion";
import {
  Button,
  Card,
  CardHeader,
  Empty,
  Select,
  StatusTag,
  Textarea,
  statusText,
  taskTone,
  useToast,
} from "../components/ui";
import { IconChat, IconClose, IconPlay } from "../components/icons";
import type { HiddenResponse, RagSource, RouteInfo } from "../lib/types";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  status?: string;
  tokens?: number;
}

interface Trace {
  runId: string;
  conversationId: string;
  status: string;
  route: RouteInfo | null;
  ragSources: RagSource[];
  hidden: HiddenResponse[];
  tokens: number;
  reason: string;
  elapsedMs: number;
}

export function PlaygroundPage() {
  const { app } = useWorkspace();
  const appId = app?.id ?? "";
  const toast = useToast();

  const agents = useAsync(() => agentsApi.list(appId), [appId], { enabled: Boolean(appId) });
  const agentName = useMemo(() => {
    const map = new Map((agents.data ?? []).map((a) => [a.id, a.name]));
    return (id: string | null | undefined) => (id ? map.get(id) ?? id : "—");
  }, [agents.data]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("你们支持七天无理由退货吗？");
  const [mode, setMode] = useState<"stream" | "sync">("stream");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息进来时滚到底部（只滚容器，不滚动整页）
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, trace]);

  const reset = () => {
    setTurns([]);
    setTrace(null);
    setConversationId(null);
  };

  const send = async () => {
    const message = input.trim();
    if (!message || busy || !appId) return;

    const startedAt = performance.now();
    const userId = "console-user";
    const assistantId = `a-${Date.now()}`;

    setBusy(true);
    setTrace(null);
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: message },
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    setInput("");

    const patchAssistant = (patch: Partial<Turn>) => {
      setTurns((prev) =>
        prev.map((turn) => (turn.id === assistantId ? { ...turn, ...patch } : turn)),
      );
    };

    if (mode === "sync") {
      try {
        const result = await chatApi.send(appId, userId, message);
        patchAssistant({
          content: result.reply ?? "（空回复）",
          streaming: false,
          status: result.status,
          tokens: result.token_usage,
        });
        setConversationId(result.conversation_id);
        setTrace({
          runId: result.run_id,
          conversationId: result.conversation_id,
          status: result.status,
          route: null,
          ragSources: result.rag_sources ?? [],
          hidden: result.hidden_responses ?? [],
          tokens: result.token_usage,
          reason: "",
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (err) {
        patchAssistant({
          content: `请求失败：${err instanceof Error ? err.message : "未知错误"}`,
          streaming: false,
          status: "failed",
        });
      } finally {
        setBusy(false);
      }
      return;
    }

    // ---- 流式 ----
    const controller = new AbortController();
    abortRef.current = controller;

    let route: RouteInfo | null = null;
    let ragSources: RagSource[] = [];
    let hidden: HiddenResponse[] = [];
    let runId = "";
    let convId = "";
    let finalStatus = "";
    let reason = "";
    let tokens = 0;

    await streamChat(
      appId,
      { user_id: userId, message, conversation_id: conversationId ?? undefined },
      {
        onEvent: (event) => {
          switch (event.type) {
            case "meta":
              runId = event.run_id;
              convId = event.conversation_id;
              setConversationId(event.conversation_id);
              break;
            case "route":
              route = {
                strategy: event.strategy,
                selected: event.selected,
                confidence: event.confidence,
                reason: event.reason,
                candidates: [],
              };
              break;
            case "rag":
              // 命中数量先到，具体来源在 done 事件里
              break;
            case "token":
              setTurns((prev) =>
                prev.map((turn) =>
                  turn.id === assistantId
                    ? { ...turn, content: turn.content + event.text }
                    : turn,
                ),
              );
              break;
            case "hidden":
              hidden = [...hidden, { action: event.action, payload: event.payload }];
              break;
            case "done":
              finalStatus = event.status;
              tokens = event.token_usage;
              ragSources = event.rag_sources ?? [];
              reason = event.reason ?? "";
              break;
            default:
              break;
          }
        },
        onError: (error) => {
          patchAssistant({
            content: `流式请求失败：${error.message}`,
            streaming: false,
            status: "failed",
          });
          toast.push("流式请求失败", "error");
        },
      },
      controller.signal,
    );

    patchAssistant({ streaming: false, status: finalStatus || "completed", tokens });
    setTrace({
      runId,
      conversationId: convId,
      status: finalStatus || "completed",
      route,
      ragSources,
      hidden,
      tokens,
      reason,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    abortRef.current = null;
    setBusy(false);
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns((prev) =>
      prev.map((turn) => (turn.streaming ? { ...turn, streaming: false, status: "cancelled" } : turn)),
    );
  };

  if (!appId) {
    return (
      <Empty
        title="尚未选择应用"
        description="在右上角选择一个应用后即可开始对话调试。"
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 text-ink-primary">对话调试台</h1>
          <p className="mt-1.5 text-body text-ink-tertiary">
            走真实链路：路由决策 → 知识库检索 → 模型生成 → 终态收敛
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            className="h-8 w-[140px]"
            value={mode}
            onChange={(e) => setMode(e.target.value as "stream" | "sync")}
            aria-label="对话模式"
          >
            <option value="stream">流式（SSE）</option>
            <option value="sync">非流式</option>
          </Select>
          <Button onClick={reset} disabled={busy}>
            清空
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex h-[640px] flex-col">
          <CardHeader
            title="会话"
            description={conversationId ? `会话 ${conversationId.slice(0, 8)}…` : "新会话"}
            extra={
              trace && (
                <StatusTag tone={taskTone(trace.status)}>{statusText(trace.status)}</StatusTag>
              )
            }
          />

          <div ref={scrollRef} className="scroll-slim flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {turns.length === 0 ? (
              <div className="relative flex h-full flex-col items-center justify-center overflow-hidden text-center">
                {/* 空白对话区给一层极光：比纯白更「有生命」，但不干扰读字 */}
                <AuroraField className="opacity-70" />
                <motion.div
                  className="relative flex flex-col items-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.42, ease: EASE }}
                >
                  <motion.span
                    className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600"
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.1 }}
                  >
                    <IconChat size={18} />
                  </motion.span>
                  <p className="text-body text-ink-secondary">输入一句话开始调试</p>
                  <p className="mt-1 max-w-sm text-caption text-ink-tertiary">
                    右侧会同步显示路由到了哪个 Agent、命中了哪些知识片段
                  </p>
                </motion.div>
              </div>
            ) : (
              turns.map((turn) =>
                turn.role === "user" ? (
                  <motion.div
                    key={turn.id}
                    className="flex justify-end"
                    initial={{ opacity: 0, y: 8, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.24, ease: EASE }}
                  >
                    <div className="max-w-[78%] rounded-card rounded-tr-sm bg-brand-500 px-3.5 py-2.5 text-body text-white">
                      {turn.content}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={turn.id}
                    className="flex justify-start"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.26, ease: EASE }}
                  >
                    <div className="max-w-[82%]">
                      <div className="mb-1 flex items-center gap-2 text-caption text-ink-tertiary">
                        <span>助手</span>
                        {turn.status && (
                          <StatusTag tone={taskTone(turn.status)}>
                            {statusText(turn.status)}
                          </StatusTag>
                        )}
                        {turn.tokens != null && turn.tokens > 0 && (
                          <span className="tabular">{turn.tokens} tokens</span>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap rounded-card rounded-tl-sm border border-line-split bg-surface px-3.5 py-2.5 text-body leading-7 text-ink-primary">
                        {turn.content}
                        {turn.streaming && <StreamCursor />}
                      </div>
                    </div>
                  </motion.div>
                ),
              )
            )}
          </div>

          <div className="border-t border-line-split px-4 py-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter 发送、Shift+Enter 换行：符合聊天工具直觉
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="输入问题，Enter 发送，Shift+Enter 换行"
              className="min-h-[64px]"
              disabled={busy}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-caption text-ink-tertiary">
                {mode === "stream" ? "SSE 流式" : "一次性返回"} · 用户 ID: console-user
              </span>
              <div className="flex gap-2">
                {busy && (
                  <Button variant="danger" icon={<IconClose size={13} />} onClick={stop}>
                    停止
                  </Button>
                )}
                <Button
                  variant="primary"
                  icon={<IconPlay size={13} />}
                  loading={busy}
                  disabled={!input.trim()}
                  onClick={() => void send()}
                >
                  发送
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="本次执行" description="路由 / 检索 / 终态" />
            {!trace ? (
              <div className="px-5 py-6 text-caption text-ink-tertiary">
                还没有执行记录。发送一条消息后这里会显示决策链路。
              </div>
            ) : (
              <motion.div
                key={trace.runId}
                className="space-y-4 px-5 py-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.24, ease: EASE }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-caption text-ink-secondary">终态</span>
                  <StatusTag tone={taskTone(trace.status)}>{statusText(trace.status)}</StatusTag>
                </div>

                <div>
                  <div className="mb-1.5 text-caption text-ink-secondary">路由决策</div>
                  {trace.route ? (
                    <motion.div
                      className="rounded-control bg-surface-fill px-3 py-2.5 text-caption"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.28, ease: EASE, delay: 0.06 }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-ink-primary">
                          {agentName(trace.route.selected)}
                        </span>
                        <span className="tabular text-ink-tertiary">
                          {trace.route.confidence != null
                            ? trace.route.confidence.toFixed(2)
                            : "—"}
                        </span>
                      </div>
                      <div className="mt-1 text-ink-tertiary">
                        策略 {trace.route.strategy} ·{" "}
                        {trace.route.reason || "无附加说明"}
                      </div>
                    </motion.div>
                  ) : (
                    <p className="text-caption text-ink-tertiary">
                      非流式模式下不返回路由事件；切到流式可看到实时决策
                    </p>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-caption text-ink-secondary">
                    <span>知识库命中</span>
                    <span className="tabular text-ink-tertiary">{trace.ragSources.length}</span>
                  </div>
                  {trace.ragSources.length === 0 ? (
                    <p className="text-caption text-ink-tertiary">未命中片段</p>
                  ) : (
                    <motion.ul
                      className="space-y-1.5"
                      variants={listContainer}
                      initial="initial"
                      animate="animate"
                    >
                      {trace.ragSources.map((source) => (
                        <motion.li
                          key={`${source.document_id}-${source.index}`}
                          variants={listItem}
                          className="rounded-control bg-surface-fill px-2.5 py-1.5"
                        >
                          <div className="flex items-center justify-between text-caption">
                            <span className="truncate text-ink-primary">
                              [{source.index}] {source.title}
                            </span>
                            <span className="tabular shrink-0 text-ink-tertiary">
                              {source.score.toFixed(3)}
                            </span>
                          </div>
                        </motion.li>
                      ))}
                    </motion.ul>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between text-caption text-ink-secondary">
                    <span>隐藏返回</span>
                    <span className="tabular text-ink-tertiary">{trace.hidden.length}</span>
                  </div>
                  {trace.hidden.length === 0 ? (
                    <p className="text-caption text-ink-tertiary">本次没有结构化动作</p>
                  ) : (
                    <pre className="scroll-slim max-h-32 overflow-auto rounded-control bg-surface-fill px-2.5 py-2 font-mono text-[11px] leading-5 text-ink-secondary">
                      {JSON.stringify(trace.hidden, null, 2)}
                    </pre>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 border-t border-line-split pt-3 text-caption">
                  <div>
                    <div className="text-ink-tertiary">耗时</div>
                    <div className="tabular text-ink-primary">{trace.elapsedMs}ms</div>
                  </div>
                  <div>
                    <div className="text-ink-tertiary">Token</div>
                    <div className="tabular text-ink-primary">{trace.tokens}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-ink-tertiary">run_id</div>
                    <div className="truncate font-mono text-[11px] text-ink-secondary">
                      {trace.runId || "—"}
                    </div>
                  </div>
                </div>

                {/*
                  只在「没走正常路径」时高亮 reason：
                  正常路由的说明已经出现在上面的「策略」里，再黄色重复一遍会让人误判为告警。
                */}
                {trace.reason && trace.status !== "completed" && (
                  <div className="rounded-control border border-[#FFE58F] bg-[#FFFBE6] px-2.5 py-2 text-caption text-[#D48806]">
                    {trace.reason}
                  </div>
                )}
              </motion.div>
            )}
          </Card>

          <Card>
            <CardHeader title="试试这些" description="覆盖不同路由分支" />
            <div className="flex flex-wrap gap-2 px-5 py-4">
              {["你们支持七天无理由退货吗？", "退款几天能到账？", "怎么开发票？", "今天天气如何"].map(
                (sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setInput(sample)}
                    className="rounded-control border border-line-base px-2.5 py-1 text-caption text-ink-secondary transition-colors hover:border-brand-400 hover:text-brand-600"
                  >
                    {sample}
                  </button>
                ),
              )}
            </div>
          </Card>
        </div>
      </div>

      {agents.data?.length === 0 && (
        <div className="mt-4">
          <Empty
            compact
            title="当前应用还没有 Agent"
            description="先去「Agent」页创建至少一个（建议设为默认兜底），否则对话无法命中执行单元。"
          />
        </div>
      )}
    </div>
  );
}
