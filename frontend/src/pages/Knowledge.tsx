/**
 * 知识库：左侧库列表 + 右侧文档与检索调试。
 *
 * 为什么把「检索调试」放在这里而不是单独页面：
 * 知识库的价值只能靠检索质量体现。入库完就能立刻在同一页面输入问题、看命中片段与
 * 相似度分数，才能判断「切分是否合理、文档是否写清楚」。拆成两个页面会让人忘记验证。
 *
 * 分数条说明：命中分数是余弦相似度（0~1），展示成细条比纯数字更易比较，
 * 但文字仍保留数值——不依赖颜色/图形单通道传达信息。
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { knowledgeApi } from "../lib/api";
import { useAsync, useSubmit } from "../lib/hooks";
import { EASE } from "../lib/motion";
import { useWorkspace } from "../state/workspace";
import {
  Button,
  Card,
  CardHeader,
  Empty,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  StatusTag,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  statusText,
  taskTone,
  useToast,
} from "../components/ui";
import { IconPlus, IconSearch, IconTrash } from "../components/icons";
import type { SearchHit } from "../lib/types";

export function KnowledgePage() {
  const { app } = useWorkspace();
  const toast = useToast();
  const kbs = useAsync(() => knowledgeApi.list(), [app?.id ?? ""], {
    enabled: Boolean(app?.id),
  });

  const [activeId, setActiveId] = useState<string>("");
  const [docOpen, setDocOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [kbName, setKbName] = useState("");
  const [kbDesc, setKbDesc] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [tookMs, setTookMs] = useState<number>(0);
  const [searching, setSearching] = useState(false);

  const { pending, run } = useSubmit();

  // 列表加载完成后默认选中第一个库，避免右侧空着
  useEffect(() => {
    if (!activeId && (kbs.data ?? []).length > 0) {
      setActiveId(kbs.data![0].id);
    }
  }, [activeId, kbs.data]);

  const docs = useAsync(
    () => (activeId ? knowledgeApi.documents(activeId) : Promise.resolve([])),
    [activeId],
    { enabled: Boolean(activeId) },
  );

  const activeKb = (kbs.data ?? []).find((kb) => kb.id === activeId) ?? null;

  const createKb = async () => {
    if (!kbName.trim()) {
      setFormError("请填写知识库名称");
      return;
    }
    try {
      const created = await knowledgeApi.create(kbName.trim(), kbDesc.trim() || undefined);
      toast.push("知识库已创建");
      setKbOpen(false);
      setKbName("");
      setKbDesc("");
      await kbs.reload();
      setActiveId(created.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    }
  };

  const ingest = async () => {
    if (!activeId) return;
    if (!docTitle.trim() || !docContent.trim()) {
      setFormError("标题与正文均为必填");
      return;
    }
    try {
      await run(async () => {
        await knowledgeApi.ingest(activeId, docTitle.trim(), docContent.trim());
      });
      toast.push("文档已入库并完成向量化");
      setDocOpen(false);
      setDocTitle("");
      setDocContent("");
      await docs.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "入库失败");
    }
  };

  const search = async () => {
    if (!activeId || !query.trim()) return;
    setSearching(true);
    try {
      const result = await knowledgeApi.search(activeId, query.trim(), 5);
      setHits(result.hits);
      setTookMs(result.took_ms);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "检索失败", "error");
    } finally {
      setSearching(false);
    }
  };

  const removeDoc = async (docId: string) => {
    if (!window.confirm("确认删除该文档？其分块与向量会一并移除。")) return;
    try {
      await knowledgeApi.removeDocument(activeId, docId);
      toast.push("已删除");
      await docs.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "删除失败", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="知识库"
        description="文档入库、切分与检索调试：先确认召回质量，再谈 RAG 效果"
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setKbOpen(true)} icon={<IconPlus size={14} />}>
              新建知识库
            </Button>
            <Button
              variant="primary"
              icon={<IconPlus size={14} />}
              disabled={!activeId}
              onClick={() => {
                setFormError(null);
                setDocOpen(true);
              }}
            >
              入库文档
            </Button>
          </div>
        }
      />

      {kbs.error && (
        <div className="mb-4">
          <ErrorNote message={kbs.error} onRetry={() => void kbs.reload()} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="知识库" description={`${kbs.data?.length ?? 0} 个`} />
          {kbs.loading ? (
            <div className="space-y-2 px-4 py-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (kbs.data ?? []).length === 0 ? (
            <div className="px-4 py-6 text-center text-caption text-ink-tertiary">
              还没有知识库
            </div>
          ) : (
            <ul className="p-2">
              {(kbs.data ?? []).map((kb) => {
                const active = kb.id === activeId;
                return (
                  <li key={kb.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(kb.id);
                        setHits(null);
                      }}
                      className={
                        "relative mb-0.5 w-full rounded-control px-2.5 py-2 text-left transition-colors " +
                        (active
                          ? "bg-brand-50 text-brand-600"
                          : "text-ink-secondary hover:bg-surface-fill hover:text-ink-primary")
                      }
                    >
                      {/* 选中条用 layoutId 在库之间滑动：它标的是「我在这一组里的哪一格」 */}
                      {active && (
                        <motion.span
                          layoutId="kb-active-bar"
                          data-kb-bar="1"
                          className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand-500"
                          transition={{ type: "spring", stiffness: 520, damping: 40 }}
                        />
                      )}
                      <div className="truncate text-body">{kb.name}</div>
                      <div className="truncate text-caption text-ink-tertiary">
                        {kb.vector_dim ?? "—"} 维 · {kb.embedding_model ?? "默认向量模型"}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title={activeKb ? activeKb.name : "文档"}
              description={activeKb?.description ?? "选择左侧知识库查看文档"}
              extra={
                activeKb && (
                  <StatusTag tone="info">{docs.data?.length ?? 0} 篇文档</StatusTag>
                )
              }
            />
            {docs.loading ? (
              <div className="space-y-2 px-6 py-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (docs.data ?? []).length === 0 ? (
              <div className="p-6">
                <Empty
                  compact
                  title="还没有文档"
                  description="入库后系统会自动切分（滑窗 + 重叠）并向量化，随后即可被检索命中。"
                  action={
                    <Button
                      variant="primary"
                      disabled={!activeId}
                      onClick={() => setDocOpen(true)}
                    >
                      入库第一篇
                    </Button>
                  }
                />
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>标题</Th>
                    <Th>来源</Th>
                    <Th>状态</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {(docs.data ?? []).map((doc, index) => (
                    <Tr key={doc.id} index={index} className="hover:bg-surface-header">
                      <Td>{doc.title}</Td>
                      <Td>
                        <span className="text-caption text-ink-tertiary">
                          {doc.source || "手动录入"}
                        </span>
                      </Td>
                      <Td>
                        <StatusTag tone={taskTone(doc.status)}>
                          {statusText(doc.status)}
                        </StatusTag>
                      </Td>
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="text"
                          className="text-state-error-fg hover:bg-state-error-bg"
                          aria-label={`删除 ${doc.title}`}
                          onClick={() => void removeDoc(doc.id)}
                        >
                          <IconTrash size={13} />
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="检索调试"
              description="输入一个真实用户问题，观察命中的片段与相似度"
            />
            <div className="px-6 py-4">
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void search();
                  }}
                  placeholder="如：退款多久能到账？"
                  disabled={!activeId}
                />
                <Button
                  variant="primary"
                  loading={searching}
                  disabled={!activeId}
                  icon={<IconSearch size={14} />}
                  onClick={() => void search()}
                >
                  检索
                </Button>
              </div>

              {hits !== null && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-caption text-ink-tertiary">
                    <span>命中 {hits.length} 条</span>
                    <span>耗时 {tookMs}ms</span>
                  </div>
                  {hits.length === 0 ? (
                    <p className="rounded-control bg-surface-fill px-3 py-4 text-center text-caption text-ink-tertiary">
                      没有命中。可能是文档未入库、切分过碎，或问题与文档表述差异过大。
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {hits.map((hit, index) => (
                        <motion.li
                          key={`${hit.document_id}-${index}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, ease: EASE, delay: index * 0.05 }}
                          className="rounded-control border border-line-split px-3 py-2.5"
                        >
                          <div className="mb-1 flex items-center justify-between gap-3">
                            <span className="truncate text-caption text-ink-secondary">
                              [{index + 1}] {hit.title}
                            </span>
                            <span className="tabular shrink-0 text-caption text-ink-tertiary">
                              {hit.score.toFixed(4)}
                            </span>
                          </div>
                          <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-surface-fill">
                            {/* 分数条从左侧长出来：检索结果是一次「测量」，条子该像尺子一样被划出来 */}
                            <motion.div
                              className="h-full w-full origin-left rounded-full bg-brand-400"
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: Math.min(1, hit.score) }}
                              transition={{ duration: 0.62, ease: EASE, delay: 0.1 + index * 0.05 }}
                            />
                          </div>
                          <p className="text-body leading-6 text-ink-primary">{hit.content}</p>
                        </motion.li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={docOpen}
        title="入库文档"
        onClose={() => setDocOpen(false)}
        width={640}
        footer={
          <>
            <Button onClick={() => setDocOpen(false)}>取消</Button>
            <Button variant="primary" loading={pending} onClick={() => void ingest()}>
              入库并向量化
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <ErrorNote message={formError} />}
          <Field label="标题" required>
            <Input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="如：退换货政策"
            />
          </Field>
          <Field label="正文" required hint="建议一段写清一件事，便于切分后仍保持语义完整">
            <Textarea
              className="min-h-[200px]"
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="粘贴文档正文…"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={kbOpen}
        title="新建知识库"
        onClose={() => setKbOpen(false)}
        footer={
          <>
            <Button onClick={() => setKbOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void createKb()}>
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <ErrorNote message={formError} />}
          <Field label="名称" required>
            <Input value={kbName} onChange={(e) => setKbName(e.target.value)} />
          </Field>
          <Field label="描述">
            <Input value={kbDesc} onChange={(e) => setKbDesc(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
