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
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { knowledgeApi } from "../lib/api";
import { useAsync, useSubmit } from "../lib/hooks";
import { EASE } from "../lib/motion";
import { useWorkspace } from "../state/workspace";
import {
  Button,
  Card,
  CardHeader,
  useConfirm,
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
  const confirm = useConfirm();
  const kbs = useAsync(() => knowledgeApi.list(), [app?.id ?? ""], {
    enabled: Boolean(app?.id),
  });

  const [activeId, setActiveId] = useState<string>("");
  const [docOpen, setDocOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docSource, setDocSource] = useState("");
  const [docFileType, setDocFileType] = useState("text");
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
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
      const created = editingKb
        ? await knowledgeApi.update(editingKb, { name: kbName.trim(), description: kbDesc.trim() || null })
        : await knowledgeApi.create(kbName.trim(), kbDesc.trim() || undefined);
      toast.push(editingKb ? "知识库设置已更新" : "知识库已创建");
      setKbOpen(false);
      setEditingKb(null);
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
    if (!uploadFile && (!docTitle.trim() || !docContent.trim())) {
      setFormError("标题与正文均为必填");
      return;
    }
    try {
      await run(async () => {
        const doc = uploadFile
          ? await knowledgeApi.upload(activeId, uploadFile)
          : await knowledgeApi.ingest(activeId, docTitle.trim(), docContent.trim(), docSource || undefined, docFileType);
        if (doc.status !== "indexed") throw new Error("文档未完成索引，请检查正文后重试");
      });
      toast.push("文档已入库并完成向量化");
      setDocOpen(false);
      setDocTitle("");
      setDocContent("");
      setDocSource("");
      setDocFileType("text");
      setUploadFile(null);
      await docs.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "入库失败");
    }
  };

  const openCreateKb = () => {
    setEditingKb(null);
    setKbName("");
    setKbDesc("");
    setFormError(null);
    setKbOpen(true);
  };

  const openEditKb = () => {
    if (!activeKb) return;
    setEditingKb(activeKb.id);
    setKbName(activeKb.name);
    setKbDesc(activeKb.description ?? "");
    setFormError(null);
    setKbOpen(true);
  };

  const loadTextFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "txt" && ext !== "md") {
      setFormError("当前只支持 .txt 和 .md 文件；PDF/Word 解析后端尚未接入");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFormError("文本文档不能超过 2 MiB");
      return;
    }
    setUploadFile(file);
    setFormError(null);
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
    if (!await confirm({ title: "删除文档", description: "删除文档后，其分块与向量会一并移除，该内容不再参与检索。", confirmLabel: "删除文档", danger: true })) return;
    try {
      await knowledgeApi.removeDocument(activeId, docId);
      toast.push("已删除");
      await docs.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "删除失败", "error");
    }
  };

  const removeKb = async () => {
    if (!activeKb) return;
    const count = docs.data?.length ?? 0;
    if (!await confirm({ title: "删除知识库", description: `删除「${activeKb.name}」及其 ${count} 篇文档？关联 Agent 将解除该知识库授权，文档分块与向量会被移除。`, confirmLabel: "删除知识库", danger: true })) return;
    try {
      await knowledgeApi.remove(activeKb.id);
      toast.push("知识库已删除，关联文档与向量已清理");
      setActiveId("");
      setHits(null);
      await kbs.reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "删除知识库失败", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="知识库"
        description="文档入库、切分与检索调试：先确认召回质量，再谈 RAG 效果"
        actions={
          <div className="flex gap-2">
            <Button onClick={openCreateKb} icon={<IconPlus size={14} />}>
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
                  <div className="flex items-center gap-2">
                    <StatusTag tone="info">{docs.data?.length ?? 0} 篇文档</StatusTag>
                    <Button size="sm" variant="text" onClick={openEditKb}>编辑</Button>
                    <Button size="sm" variant="text" disabled={docs.loading} className="text-state-error-fg hover:bg-state-error-bg" icon={<IconTrash size={13} />} onClick={() => void removeKb()}>删除知识库</Button>
                  </div>
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
          <input ref={uploadRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => void loadTextFile(event)} />
          <div className="flex items-center justify-between gap-3 rounded-control border border-line-split bg-surface-fill px-3 py-2.5"><div><div className="text-body font-medium text-ink-primary">上传文本文件</div><div className="mt-0.5 text-caption text-ink-tertiary">支持 UTF-8 .txt / .md，最大 2 MiB；PDF/Word 解析尚未接入</div></div><Button size="sm" disabled={pending} onClick={() => uploadRef.current?.click()}>选择文件</Button></div>
          {uploadFile && <div className="flex items-center justify-between gap-2 text-caption text-ink-secondary"><span>待上传：{uploadFile.name}（标题取文件名，正文由服务端解析）</span><Button size="sm" disabled={pending} onClick={() => setUploadFile(null)}>改为手动录入</Button></div>}
          {docSource && <div className="text-caption text-ink-tertiary">来源：{docSource}</div>}
          <Field label="标题" required>
            <Input
              value={docTitle}
              disabled={Boolean(uploadFile) || pending}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="如：退换货政策"
            />
          </Field>
          <Field label="正文" required hint="建议一段写清一件事，便于切分后仍保持语义完整">
            <Textarea
              className="min-h-[200px]"
              value={docContent}
              disabled={Boolean(uploadFile) || pending}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="粘贴文档正文…"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={kbOpen}
        title={editingKb ? "编辑知识库" : "新建知识库"}
        onClose={() => { setKbOpen(false); setEditingKb(null); }}
        footer={
          <>
            <Button onClick={() => { setKbOpen(false); setEditingKb(null); }}>取消</Button>
            <Button variant="primary" onClick={() => void createKb()}>
              {editingKb ? "保存" : "创建"}
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
