import { useState } from "react";

import { conversationsApi } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useWorkspace } from "../state/workspace";
import {
  Button,
  Card,
  CardHeader,
  useConfirm,
  Empty,
  ErrorNote,
  Input,
  PageHeader,
  Skeleton,
  StatusTag,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from "../components/ui";
import { IconArchive, IconRefresh, IconSearch } from "../components/icons";
import type { Conversation } from "../lib/types";

export function ConversationsPage() {
  const { app } = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const [userFilter, setUserFilter] = useState("");
  const [appliedUserFilter, setAppliedUserFilter] = useState("");
  const [page, setPage] = useState(1);
  const [messagePage, setMessagePage] = useState(1);
  const [active, setActive] = useState<Conversation | null>(null);
  const conversations = useAsync(() => conversationsApi.list(page, appliedUserFilter.trim() || undefined), [app?.id, page, appliedUserFilter], { enabled: Boolean(app?.id) });
  const messages = useAsync(() => active ? conversationsApi.messages(active.id, messagePage) : Promise.resolve({ items: [], total: 0, page: 1, page_size: 50 }), [active?.id, messagePage], { enabled: Boolean(active?.id) });

  const selectConversation = (conversation: Conversation) => {
    setActive(conversation);
    setMessagePage(1);
  };

  const archive = async (conversation: Conversation) => {
    if (!await confirm({ title: "归档会话", description: `归档「${conversation.title || conversation.id.slice(0, 8)}」？终态会话保留消息供审计，执行中的会话不能归档。`, confirmLabel: "归档会话", danger: true })) return;
    try {
      await conversationsApi.archive(conversation.id);
      if (active?.id === conversation.id) setActive(null);
      await conversations.reload();
      toast.push("会话已归档");
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "归档失败", "error");
    }
  };

  return (
    <div>
      <PageHeader title="会话记录" description="查看当前应用的会话与消息；归档会话会保留审计记录" actions={<Button icon={<IconRefresh size={13} />} onClick={() => void conversations.reload()}>刷新</Button>} />
      {!app && <ErrorNote message="请先选择应用" />}
      {conversations.error && <div className="mb-4"><ErrorNote message={conversations.error} onRetry={() => void conversations.reload()} /></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <Card>
          <CardHeader title="会话" description={`${conversations.data?.total ?? 0} 条`} extra={<form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedUserFilter(userFilter); }}><Input aria-label="按用户 ID 筛选" className="h-8 w-44" value={userFilter} onChange={(event) => setUserFilter(event.target.value)} placeholder="筛选 user_id" /><Button size="sm" variant="text" icon={<IconSearch size={13} />} aria-label="搜索会话" /></form>} />
          {conversations.loading ? <div className="space-y-2 px-5 py-4"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div> : (conversations.data?.items ?? []).length === 0 ? <div className="p-5"><Empty title="暂无会话" description="选择应用并产生对话后，会话记录将显示在这里。" /></div> : <Table>
            <thead><tr><Th>标题 / ID</Th><Th>用户</Th><Th>状态</Th><Th>更新时间</Th><Th align="right">操作</Th></tr></thead>
            <tbody>{(conversations.data?.items ?? []).map((conversation, index) => <Tr key={conversation.id} index={index} className={active?.id === conversation.id ? "bg-surface-header" : ""}>
              <Td><button type="button" className="max-w-48 text-left" onClick={() => selectConversation(conversation)}><span className="block truncate font-medium text-brand-300">{conversation.title || "未命名会话"}</span><code className="text-[10px] text-ink-tertiary">{conversation.id.slice(0, 12)}…</code></button></Td>
              <Td><code className="text-caption text-ink-secondary">{conversation.user_id}</code></Td>
              <Td><StatusTag tone={conversation.status === "active" ? "success" : "default"}>{conversation.status === "active" ? "活动" : "已归档"}</StatusTag></Td>
              <Td><span className="whitespace-nowrap text-caption text-ink-tertiary">{new Date(conversation.updated_at).toLocaleString()}</span></Td>
              <Td align="right"><div className="flex justify-end gap-1"><Button size="sm" variant="text" onClick={() => selectConversation(conversation)}>查看</Button>{conversation.status !== "archived" && <Button size="sm" variant="text" className="text-state-warning-fg" title="归档会话" aria-label={`归档 ${conversation.title || conversation.id}`} onClick={() => void archive(conversation)}><IconArchive size={13} /></Button>}</div></Td>
            </Tr>)}</tbody>
          </Table>}
          {!conversations.loading && (conversations.data?.total ?? 0) > 25 && <div className="flex items-center justify-between border-t border-line-split px-5 py-3 text-caption text-ink-tertiary"><span>第 {page} 页 / 共 {Math.ceil((conversations.data?.total ?? 0) / 25)} 页</span><div className="flex gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button><Button size="sm" disabled={page * 25 >= (conversations.data?.total ?? 0)} onClick={() => setPage((value) => value + 1)}>下一页</Button></div></div>}
        </Card>

        <Card className="min-h-[520px]">
          <CardHeader title={active?.title || "消息详情"} description={active ? `${active.user_id} · ${active.id}` : "选择会话查看消息"} />
          {!active ? <div className="px-5 py-7"><Empty compact title="未选择会话" /></div> : messages.error ? <div className="p-5"><ErrorNote message={messages.error} onRetry={() => void messages.reload()} /></div> : messages.loading ? <div className="space-y-3 px-5 py-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : (messages.data?.items ?? []).length === 0 ? <div className="px-5 py-7"><Empty compact title="会话中没有消息" /></div> : <div className="scroll-slim max-h-[680px] space-y-3 overflow-y-auto px-5 py-4">
            {(messages.data?.items ?? []).map((message) => <div key={message.id} className={`rounded-control border border-line-split px-3 py-2.5 ${message.role === "user" ? "bg-brand-500/10" : "bg-surface-fill"}`}><div className="mb-1 flex items-center justify-between text-[11px] text-ink-tertiary"><span>{message.role === "user" ? "用户" : message.role === "assistant" ? "Agent" : message.role}</span><time>{new Date(message.created_at).toLocaleString()}</time></div><p className="whitespace-pre-wrap text-body leading-6 text-ink-primary">{message.content || "（无文本内容）"}</p></div>)}
          </div>}
          {active && (messages.data?.total ?? 0) > 50 && <div className="flex items-center justify-between border-t border-line-split px-5 py-3 text-caption text-ink-tertiary"><span>消息第 {messagePage} 页</span><div className="flex gap-2"><Button size="sm" disabled={messagePage <= 1} onClick={() => setMessagePage((value) => value - 1)}>上一页</Button><Button size="sm" disabled={messagePage * 50 >= (messages.data?.total ?? 0)} onClick={() => setMessagePage((value) => value + 1)}>下一页</Button></div></div>}
        </Card>
      </div>
    </div>
  );
}
