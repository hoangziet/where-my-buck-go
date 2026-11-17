"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Check, Paperclip, Camera, ArrowUp, Receipt, Bookmark, Database, Sparkles, PanelLeft, RotateCw } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { ChatSidebar } from "@/components/ChatSidebar";
import { appLocalISODate, formatNumber, formatVND } from "@/lib/format";
import * as api from "@/lib/api";
import type { Category, ChatHistoryItem, ProposalDto, TraceEntry, TransactionDto } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/api";

type AssistantMessage = (
  | { role: "assistant"; kind: "qa"; text: string; start?: string; end?: string }
  | { role: "assistant"; kind: "intake"; text: string; proposals: ProposalDto[]; errors: { index: number; error: string }[] }
  | {
      role: "assistant";
      kind: "needs_selection";
      text: string;
      candidates: TransactionDto[];
      operation?: "edit" | "delete" | "undo";
    }
  | { role: "assistant"; kind: "change"; text: string; proposal: ProposalDto }
  | { role: "assistant"; kind: "image_intake"; text: string; proposal: ProposalDto }
  | { role: "assistant"; kind: "error"; text: string }
  | { role: "assistant"; kind: "stored"; text: string }
) & { debugTrace?: TraceEntry[] };

type Message = { role: "user"; text: string; imagePreviewUrl?: string } | AssistantMessage;

type ChatRetry =
  | {
      kind: "text";
      text: string;
      history: ChatHistoryItem[];
      pendingProposalIds: string[];
      chatId?: string;
      idempotencyKey: string;
    }
  | { kind: "image"; file: File; caption: string; chatId?: string; idempotencyKey: string };

type ConfirmState = Record<
  string,
  { transactionId: string } | "discarded" | "error" | "pending" | "discarding" | "discard_error"
>;

const MAX_IMAGE_BYTES = 4_000_000;
const MAX_PENDING_DRAFTS = 5;

function messageProposals(m: Message): ProposalDto[] {
  if (m.role !== "assistant") return [];
  if (m.kind === "intake") return m.proposals;
  if (m.kind === "change" || m.kind === "image_intake") return [m.proposal];
  return [];
}

function isEditableDraft(p: ProposalDto): boolean {
  return p.state === "draft" && (p.operation === "create" || p.operation === "edit");
}

/** Short, model-readable summary so a follow-up message can refer back to these drafts. */
function draftSummary(p: ProposalDto): string {
  const amount = p.amount ? `${p.direction === "income" ? "+" : "-"}${p.amount} VND` : "amount missing";
  const when = `${p.occurredDate ?? "date missing"} ${p.period} ${p.occurredTime} (${p.timeSource})`;
  return `[Draft ${p.id}] ${p.description} · ${amount} · ${p.category} · ${when}`;
}

function replaceProposal(messages: Message[], updated: ProposalDto): Message[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    if (m.kind === "intake" && m.proposals.some((p) => p.id === updated.id)) {
      return { ...m, proposals: m.proposals.map((p) => (p.id === updated.id ? updated : p)) };
    }
    if ((m.kind === "change" || m.kind === "image_intake") && m.proposal.id === updated.id) {
      return { ...m, proposal: updated };
    }
    return m;
  });
}

/** A revised draft is shown again in the newest reply; drop its stale card from earlier replies. */
function removeProposals(messages: Message[], ids: Set<string>): Message[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    if (m.kind === "intake" && m.proposals.some((p) => ids.has(p.id))) {
      return { ...m, proposals: m.proposals.filter((p) => !ids.has(p.id)) };
    }
    if ((m.kind === "change" || m.kind === "image_intake") && ids.has(m.proposal.id)) {
      return { role: "assistant", kind: "stored", text: m.text, debugTrace: m.debugTrace };
    }
    return m;
  });
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageRoute />
    </Suspense>
  );
}

function ChatPageRoute() {
  const urlChatId = useSearchParams().get("id") ?? undefined;
  return <ChatPageInner urlChatId={urlChatId} />;
}

function ChatPageInner({ urlChatId }: { urlChatId?: string }) {
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<ChatHistoryItem[]>([]);
  const [chatId, setChatId] = useState<string | undefined>(urlChatId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [refreshSidebarTrigger, setRefreshSidebarTrigger] = useState(0);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({});
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());
  const [selectingIds, setSelectingIds] = useState<Set<string>>(new Set());
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const ownedChatId = useRef<string | undefined | null>(null);
  const retryRequest = useRef<ChatRetry | null>(null);
  const proposalIdempotencyKeys = useRef(new Map<string, string>());
  const imagePreviewUrls = useRef(new Set<string>());

  useEffect(() => () => {
    for (const url of imagePreviewUrls.current) URL.revokeObjectURL(url);
    imagePreviewUrls.current.clear();
  }, []);

  function proposalActionKey(action: "confirm" | "discard", proposalId: string): string {
    const key = `${action}:${proposalId}`;
    const existing = proposalIdempotencyKeys.current.get(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    proposalIdempotencyKeys.current.set(key, created);
    return created;
  }

  useEffect(() => {
    if (urlChatId === ownedChatId.current) return;
    ownedChatId.current = urlChatId;
    if (!urlChatId) {
      queueMicrotask(() => {
        setMessages([]);
        setHistory([]);
        setChatId(undefined);
      });
      return;
    }
    let active = true;
    api.getChatMessages(urlChatId)
      .then((res) => {
        if (!active) return;
        setChatId(urlChatId);
        setMessages(res.items.map((m) => (m.role === "user"
          ? { role: "user", text: m.text }
          : { role: "assistant", kind: "stored", text: m.text, debugTrace: m.debugTrace ?? undefined })));
        setHistory(res.items.slice(-8).map((m) => ({ role: m.role, text: m.text })));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessages([{
          role: "assistant",
          kind: "error",
          text: error instanceof Error ? error.message : "Could not load this chat.",
        }]);
      });
    return () => {
      active = false;
    };
  }, [urlChatId]);

  function pushHistory(userText: string, assistantText: string) {
    setHistory((prev) =>
      [...prev, { role: "user" as const, text: userText }, { role: "assistant" as const, text: assistantText }].slice(-8),
    );
  }

  function startNewChat() {
    router.push("/chat");
  }

  function stageImage(file: File) {
    if (!(["image/png", "image/jpeg"].includes(file.type))) {
      setMessages((prev) => [...prev, { role: "assistant", kind: "error", text: "Only PNG and JPEG images are supported." }]);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMessages((prev) => [...prev, { role: "assistant", kind: "error", text: "Image is larger than 4 MB. Please use a smaller photo." }]);
      return;
    }
    if (pendingImageUrl) {
      URL.revokeObjectURL(pendingImageUrl);
      imagePreviewUrls.current.delete(pendingImageUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    imagePreviewUrls.current.add(previewUrl);
    setPendingImage(file);
    setPendingImageUrl(previewUrl);
  }

  function removePendingImage() {
    if (pendingImageUrl) {
      URL.revokeObjectURL(pendingImageUrl);
      imagePreviewUrls.current.delete(pendingImageUrl);
    }
    setPendingImage(null);
    setPendingImageUrl(null);
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !pendingImage) || sending) return;
    if (pendingImage) {
      await sendImage(pendingImage, text);
      return;
    }
    const pendingProposalIds = messages
      .flatMap(messageProposals)
      .filter((p) => isEditableDraft(p) && (!confirmState[p.id] || confirmState[p.id] === "error"))
      .map((p) => p.id)
      .slice(-MAX_PENDING_DRAFTS);
    const previousRetry = retryRequest.current;
    const request = previousRetry?.kind === "text"
      && previousRetry.text === text
      && previousRetry.chatId === chatId
      && JSON.stringify(previousRetry.history) === JSON.stringify(history)
      && JSON.stringify(previousRetry.pendingProposalIds) === JSON.stringify(pendingProposalIds)
      ? previousRetry
      : { kind: "text" as const, text, history, pendingProposalIds, chatId, idempotencyKey: crypto.randomUUID() };
    const isRetry = request === previousRetry;
    if (!isRetry) setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setSending(true);
    try {
      const res = await api.sendChatMessage(
        text, request.history, request.chatId, request.idempotencyKey, request.pendingProposalIds,
      );
      if (res.chatId && res.chatId !== chatId) {
        setChatId(res.chatId);
        ownedChatId.current = res.chatId;
        setRefreshSidebarTrigger((prev) => prev + 1);
        router.replace(`/chat?id=${res.chatId}`);
      }
      let assistant: AssistantMessage;
      let historyText = res.message;
      if (res.kind === "qa") {
        assistant = { role: "assistant", kind: "qa", text: res.message, start: res.start, end: res.end };
      } else if (res.kind === "intake") {
        assistant = { role: "assistant", kind: "intake", text: res.message, proposals: res.proposals, errors: res.errors };
        historyText = [res.message, ...res.proposals.map(draftSummary)].join("\n").slice(0, 2000);
      } else if (res.kind === "change") {
        assistant = { role: "assistant", kind: "change", text: res.message, proposal: res.proposal };
      } else {
        assistant = {
          role: "assistant",
          kind: "needs_selection",
          text: res.message,
          candidates: res.candidates ?? [],
          operation: res.operation,
        };
      }
      assistant = { ...assistant, debugTrace: res.debugTrace };
      const revised = new Set(res.kind === "intake" ? res.revisedProposalIds ?? [] : []);
      setMessages((prev) => [...(revised.size ? removeProposals(prev, revised) : prev), assistant]);
      pushHistory(text, historyText);
      retryRequest.current = null;
    } catch (err) {
      retryRequest.current = request;
      setInput(text);
      const text2 = err instanceof Error ? err.message : "Something went wrong";
      const debugTrace = err instanceof api.ApiError && Array.isArray(err.payload?.debugTrace)
        ? err.payload.debugTrace as TraceEntry[] : undefined;
      setMessages((prev) => [...prev, {
        role: "assistant", kind: "error", text: `${text2} Your message is back in the composer; resend to retry safely.`, debugTrace,
      }]);
    } finally {
      setSending(false);
    }
  }

  async function handlePin(index: number, title: string, start: string, end: string) {
    if (pinnedIds.has(index)) return;
    setPinnedIds((prev) => new Set(prev).add(index));
    try {
      await api.createPin(title.slice(0, 80), start, end);
    } catch {
      setPinnedIds((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  }

  async function sendImage(file: File, caption: string) {
    const previewUrl = pendingImageUrl ?? URL.createObjectURL(file);
    imagePreviewUrls.current.add(previewUrl);
    const previousRetry = retryRequest.current;
    const request = previousRetry?.kind === "image"
      && previousRetry.file === file
      && previousRetry.caption === caption
      && previousRetry.chatId === chatId
      ? previousRetry
      : { kind: "image" as const, file, caption, chatId, idempotencyKey: crypto.randomUUID() };
    const isRetry = request === previousRetry;
    setInput("");
    setPendingImage(null);
    setPendingImageUrl(null);
    if (!isRetry) setMessages((prev) => [...prev, { role: "user", text: caption, imagePreviewUrl: previewUrl }]);
    setSending(true);
    try {
      const res = await api.imageIntake(file, caption || undefined, request.idempotencyKey, chatId);
      if (res.chatId && res.chatId !== chatId) {
        setChatId(res.chatId);
        ownedChatId.current = res.chatId;
        setRefreshSidebarTrigger((prev) => prev + 1);
        router.replace(`/chat?id=${res.chatId}`);
      }
      setMessages((prev) => [...prev, {
        role: "assistant", kind: "image_intake", text: res.message, proposal: res.proposal,
        debugTrace: res.debugTrace,
      }]);
      pushHistory(caption || "Hình ảnh hóa đơn", res.message);
      retryRequest.current = null;
    } catch (err) {
      retryRequest.current = request;
      setInput(caption);
      setPendingImage(file);
      setPendingImageUrl(previewUrl);
      const text = err instanceof Error ? err.message : "Could not read that image";
      const debugTrace = err instanceof api.ApiError && Array.isArray(err.payload?.debugTrace)
        ? err.payload.debugTrace as TraceEntry[] : undefined;
      setMessages((prev) => [...prev, {
        role: "assistant", kind: "error", text: `${text} The image is back in the composer; resend to retry safely.`, debugTrace,
      }]);
    } finally {
      setSending(false);
    }
  }

  function handlePasteImage(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const image = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const file = image?.getAsFile();
    if (!file) return;
    event.preventDefault();
    stageImage(new File([file], file.name || "pasted-image.png", { type: file.type }));
  }

  async function handleConfirm(original: ProposalDto, edits: api.DraftFields | null) {
    const existing = confirmState[original.id];
    if (existing && existing !== "error") return;
    setConfirmState((prev) => ({ ...prev, [original.id]: "pending" }));
    let proposal = original;
    try {
      if (edits) {
        proposal = await api.amendProposal(
          original.id, original.version, edits, `Edited draft "${edits.description}" in chat before confirming`,
        );
        setMessages((prev) => replaceProposal(prev, proposal));
        proposalIdempotencyKeys.current.delete(`confirm:${original.id}`);
      }
      const { transaction } = await api.confirmProposal(
        proposal.id, proposal.version, proposalActionKey("confirm", proposal.id),
      );
      setConfirmState((prev) => ({ ...prev, [proposal.id]: { transactionId: transaction.id } }));
      proposalIdempotencyKeys.current.delete(`confirm:${proposal.id}`);
    } catch {
      setConfirmState((prev) => ({ ...prev, [proposal.id]: "error" }));
    }
  }

  async function handleDiscard(proposal: ProposalDto) {
    const current = confirmState[proposal.id];
    if (current && current !== "discard_error") return;
    setConfirmState((prev) => ({ ...prev, [proposal.id]: "discarding" }));
    try {
      await api.discardProposal(
        proposal.id, proposal.version, proposalActionKey("discard", proposal.id),
      );
      setConfirmState((prev) => ({ ...prev, [proposal.id]: "discarded" }));
      proposalIdempotencyKeys.current.delete(`discard:${proposal.id}`);
    } catch {
      setConfirmState((prev) => ({ ...prev, [proposal.id]: "discard_error" }));
    }
  }

  async function handleSelectCandidate(candidate: TransactionDto, operation: "edit" | "delete" | "undo") {
    if (selectingIds.has(candidate.id)) return;
    setSelectingIds((prev) => new Set(prev).add(candidate.id));
    try {
      const proposal = await api.proposeChange(
        operation,
        candidate.id,
        candidate.version,
        `Selected "${candidate.description}" to ${operation} from a chat suggestion`,
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", kind: "change", text: `Bản nháp ${operation} đã sẵn sàng; cần xác nhận riêng.`, proposal },
      ]);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not create that proposal";
      setMessages((prev) => [...prev, { role: "assistant", kind: "error", text }]);
    } finally {
      setSelectingIds((prev) => {
        const next = new Set(prev);
        next.delete(candidate.id);
        return next;
      });
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden min-h-screen lg:min-h-0">
      <ChatSidebar
        activeChatId={chatId}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((prev) => !prev)}
        onSelectChat={(id) => router.push(`/chat?id=${id}`)}
        onNewChat={startNewChat}
        refreshTrigger={refreshSidebarTrigger}
      />

      <main className="flex-1 flex flex-col min-w-0 min-h-screen lg:min-h-0 overflow-y-auto">
        <header className="flex items-center gap-2 px-3.5 py-3 border-b border-border-nav bg-surface sticky top-0 z-20">
          <button
            type="button"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="w-10 h-10 flex items-center justify-center text-ink-3 hover:text-ink rounded-lg transition-colors duration-150 hover:bg-[#F4F2EC] border-0 bg-transparent cursor-pointer"
          >
            <PanelLeft size={19} />
          </button>
          <span className="flex-1 font-semibold text-sm lg:text-base truncate">
            {chatId ? "AI Chat" : "New Chat"}
          </span>
          <button
            type="button"
            aria-label="New chat"
            onClick={startNewChat}
            className="w-10 h-10 border-0 bg-transparent text-ink-3 hover:text-ink rounded-lg cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] flex items-center justify-center"
          >
            <Plus size={19} />
          </button>
        </header>

        <div className="flex-1 px-4 lg:px-8 pb-40 lg:pb-8 flex flex-col">
          <div role="log" aria-live="polite" className="w-full max-w-[860px] mx-auto flex flex-col gap-7 pt-4">

          {messages.length === 0 && (
            <p className="m-0 text-sm text-muted">
              Log a spend (&ldquo;pho 45k this morning&rdquo;), attach a receipt photo, or ask a question about your money.
            </p>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserBubble key={i} imagePreviewUrl={m.imagePreviewUrl}>{m.text}</UserBubble>
            ) : (
              <AiMessage key={i}>
                {m.kind === "qa" && (
                  <>
                    <FormattedMessage text={m.text} />
                    {m.start && m.end && (
                      <div className="flex flex-col gap-2 self-start">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePin(i, m.text, m.start!, m.end!)}
                            disabled={pinnedIds.has(i)}
                            className={`flex items-center gap-2 border rounded-[10px] px-3.5 min-h-9 text-[13px] font-medium cursor-pointer transition-colors duration-150 ${
                              pinnedIds.has(i)
                                ? "bg-accent-soft-bg text-accent-strong border-accent-soft-border"
                                : "bg-surface text-ink border-border-input hover:bg-[#F4F2EC]"
                            }`}
                          >
                            <Bookmark size={14} />
                            {pinnedIds.has(i) ? "Pinned to Dashboard" : "Pin to Dashboard"}
                          </button>
                          <RefreshRangeDataButton start={m.start} end={m.end} />
                        </div>
                      </div>
                    )}
                  </>
                )}
                {m.kind === "error" && <p role="alert" className="m-0 text-danger">{m.text}</p>}
                {m.kind === "stored" && <FormattedMessage text={m.text} />}
                {m.kind === "needs_selection" && (
                  <>
                    <FormattedMessage text={m.text} />
                    {m.candidates.map((c) => (
                      <CandidateCard
                        key={c.id}
                        candidate={c}
                        disabled={selectingIds.has(c.id)}
                        onSelect={() => handleSelectCandidate(c, m.operation ?? "delete")}
                      />
                    ))}
                  </>
                )}
                {m.kind === "change" && (
                  <>
                    <FormattedMessage text={m.text} />
                    <ProposalCard
                      key={`${m.proposal.id}:${m.proposal.version}`}
                      proposal={m.proposal}
                      state={confirmState[m.proposal.id]}
                      onConfirm={(edits) => handleConfirm(m.proposal, edits)}
                      onDiscard={() => handleDiscard(m.proposal)}
                    />
                  </>
                )}
                {m.kind === "intake" && (
                  <>
                    <FormattedMessage text={m.text} />
                    {m.proposals.map((p) => (
                      <ProposalCard
                        key={`${p.id}:${p.version}`}
                        proposal={p}
                        state={confirmState[p.id]}
                        onConfirm={(edits) => handleConfirm(p, edits)}
                        onDiscard={() => handleDiscard(p)}
                      />
                    ))}
                    {m.errors.map((e) => (
                      <p key={e.index} role="alert" className="m-0 text-sm text-danger">
                        Item {e.index + 1}: {e.error}
                      </p>
                    ))}
                  </>
                )}
                {m.kind === "image_intake" && (
                  <>
                    <p className="m-0">{m.text}</p>
                    <div className="flex items-center gap-2 text-[13px] text-ink-3">
                      <Receipt size={15} className="text-accent" />
                      <span>Read from image</span>
                    </div>
                    <ProposalCard
                      key={`${m.proposal.id}:${m.proposal.version}`}
                      proposal={m.proposal}
                      state={confirmState[m.proposal.id]}
                      onConfirm={(edits) => handleConfirm(m.proposal, edits)}
                      onDiscard={() => handleDiscard(m.proposal)}
                    />
                  </>
                )}
                {m.debugTrace && m.debugTrace.length > 0 && <TracePanel entries={m.debugTrace} />}
              </AiMessage>
            ),
          )}
          {sending && <p className="m-0 text-sm text-muted">Thinking…</p>}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 lg:static lg:mt-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 lg:px-8 bg-bg lg:bg-transparent">
        <div className="w-full max-w-[860px] mx-auto flex flex-col gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="bg-surface border border-border-input rounded-[20px] p-3.5 flex flex-col gap-2.5 shadow-[0_12px_32px_-20px_rgba(22,32,26,0.25)] transition-colors duration-150 has-[textarea:focus]:border-accent"
          >
            {pendingImageUrl && (
              <div className="relative w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingImageUrl} alt="Attached receipt" className="h-20 w-20 rounded-[12px] object-cover border border-border-input" />
                <button
                  type="button"
                  aria-label="Remove attached image"
                  onClick={removePendingImage}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-ink text-white border-0 flex items-center justify-center cursor-pointer text-xs leading-none"
                >
                  ✕
                </button>
              </div>
            )}
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              rows={2}
              placeholder={pendingImage ? "Add a caption (optional)…" : "Log a spend, attach a receipt, or ask about your money…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePasteImage}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className="text-[16px] sm:text-[15px] border-0 outline-none resize-none bg-transparent text-ink px-0.5 py-1"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) stageImage(file);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={cameraInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) stageImage(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  aria-label="Attach image"
                  onClick={() => fileInput.current?.click()}
                  className="w-10 h-10 rounded-[10px] border-0 bg-transparent text-ink-3 flex items-center justify-center cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
                >
                  <Paperclip size={20} strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  aria-label="Take a photo"
                  onClick={() => cameraInput.current?.click()}
                  className="w-10 h-10 rounded-[10px] border-0 bg-transparent text-ink-3 flex items-center justify-center cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
                >
                  <Camera size={20} strokeWidth={1.9} />
                </button>
              </div>
              <button
                type="submit"
                aria-label="Send"
                disabled={sending || (!input.trim() && !pendingImage)}
                className="w-11 h-11 rounded-full border-0 bg-accent text-white flex items-center justify-center cursor-pointer transition-colors duration-150 hover:bg-accent-strong disabled:opacity-50"
              >
                <ArrowUp size={20} strokeWidth={2.2} />
              </button>
            </div>
          </form>
          <span className="text-xs text-muted text-center">Nothing is saved until you confirm it. Paste a PNG/JPEG with Ctrl+V.</span>
        </div>
      </div>
      </main>
    </div>
  );
}

function UserBubble({ children, imagePreviewUrl }: { children: React.ReactNode; imagePreviewUrl?: string }) {
  return (
    <div className="self-end max-w-[75%] flex flex-col items-end gap-1.5">
      {imagePreviewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagePreviewUrl} alt="Attached receipt" className="max-w-[220px] max-h-[220px] rounded-[14px] object-cover" />
      )}
      {children && (
        <div className="bg-ink text-white px-4 py-3 rounded-[16px_16px_4px_16px] whitespace-pre-wrap">{children}</div>
      )}
    </div>
  );
}

function AiMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5 items-start">
      <LogoMark size={30} />
      <div className="flex-1 min-w-0 flex flex-col gap-3">{children}</div>
    </div>
  );
}

function RefreshRangeDataButton({ start, end }: { start: string; end: string }) {
  const [loading, setLoading] = useState(false);
  const [liveTotals, setLiveTotals] = useState<{
    income: number;
    expense: number;
    count: number;
    refreshedAt: string;
  } | null>(null);

  async function handleRefresh() {
    setLoading(true);
    try {
      const res = await api.listTransactions();
      const inRange = res.items.filter((t) => !t.deleted && t.occurredDate >= start && t.occurredDate <= end);
      let income = 0;
      let expense = 0;
      for (const t of inRange) {
        const val = Number(t.amount);
        if (t.direction === "income") income += val;
        else expense += val;
      }
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      setLiveTotals({ income, expense, count: inRange.length, refreshedAt: timeStr });
    } catch {
      // silently fallback
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={loading}
        className="flex items-center gap-2 border rounded-[10px] px-3.5 min-h-9 text-[13px] font-medium bg-surface text-ink border-border-input hover:bg-[#F4F2EC] cursor-pointer transition-colors duration-150 disabled:opacity-50"
      >
        <RotateCw size={14} className={loading ? "animate-spin text-accent" : "text-muted"} />
        <span>{loading ? "Đang tính toán…" : "Làm mới số liệu"}</span>
      </button>
      {liveTotals && (
        <div className="p-3 rounded-xl border border-accent-soft-border bg-[#F4F8F5] text-xs flex flex-col gap-1.5 animate-fadeIn">
          <div className="flex items-center justify-between text-muted text-[11px]">
            <span className="font-medium text-accent-strong">Số liệu mới nhất ({start} → {end})</span>
            <span>Cập nhật lúc {liveTotals.refreshedAt}</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[13px]">
            <span className="text-[#1E7E34] font-medium">+Thu: {formatVND(liveTotals.income)}</span>
            <span className="text-ink font-medium">−Chi: {formatVND(liveTotals.expense)}</span>
            <span className="text-muted text-xs">({liveTotals.count} giao dịch)</span>
          </div>
        </div>
      )}
    </div>
  );
}

function isAmountHeader(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes("tiền") || h.includes("amount") || h.includes("giá") || h.includes("thu") || h.includes("chi");
}

function isCategoryHeader(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes("danh mục") || h.includes("category");
}

function isDateOrTimeHeader(header: string): boolean {
  const h = header.toLowerCase();
  return h.includes("ngày") || h.includes("date") || h.includes("giờ") || h.includes("time");
}

function formatTableCell(header: string, cell: string) {
  if (isCategoryHeader(header)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#EFECE6] text-ink-2">
        {cell}
      </span>
    );
  }
  if (isAmountHeader(header)) {
    const isPositive = cell.trim().startsWith("+");
    const isNegative = cell.trim().startsWith("-");
    const colorClass = isPositive
      ? "text-[#1E7E34] font-semibold"
      : isNegative
      ? "text-ink font-semibold"
      : "text-ink font-medium";
    return <span className={`font-mono ${colorClass}`}>{cell}</span>;
  }
  return cell;
}

function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ({ type: "text"; lines: string[] } | { type: "table"; headers: string[]; rows: string[][] })[] = [];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const headers = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith("|") && lines[i + 1].includes("-")) {
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
          const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
          rows.push(cells);
          i++;
        }
        blocks.push({ type: "table", headers, rows });
        continue;
      }
    }
    const last = blocks[blocks.length - 1];
    if (last && last.type === "text") {
      last.lines.push(lines[i]);
    } else {
      blocks.push({ type: "text", lines: [lines[i]] });
    }
    i++;
  }

  return (
    <div className="flex flex-col gap-2.5 text-inherit">
      {blocks.map((block, idx) => {
        if (block.type === "table") {
          return (
            <div key={idx} className="my-1.5 overflow-x-auto rounded-xl border border-border bg-surface shadow-xs">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F4F2EC] text-ink font-semibold border-b border-border">
                    {block.headers.map((h, hIdx) => {
                      const isAmount = isAmountHeader(h);
                      const isDate = isDateOrTimeHeader(h);
                      const align = isAmount ? "text-right" : isDate ? "text-center" : "text-left";
                      return (
                        <th
                          key={hIdx}
                          className={`px-3.5 py-2.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider ${align}`}
                        >
                          {h}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-row">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-[#FAF9F5] transition-colors">
                      {row.map((cell, cIdx) => {
                        const h = block.headers[cIdx] || "";
                        const isAmount = isAmountHeader(h);
                        const isDate = isDateOrTimeHeader(h);
                        const align = isAmount ? "text-right" : isDate ? "text-center" : "text-left";
                        return (
                          <td key={cIdx} className={`px-3.5 py-2.5 text-ink-2 whitespace-nowrap ${align}`}>
                            {formatTableCell(h, cell)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        const paragraph = block.lines.join("\n").trim();
        if (!paragraph) return null;
        return (
          <p key={idx} className="m-0 leading-relaxed whitespace-pre-wrap">
            {paragraph}
          </p>
        );
      })}
    </div>
  );
}

function StepDataPreview({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  if (obj.totals && typeof obj.totals === "object") {
    const totals = obj.totals as { income?: string; expense?: string };
    const range = obj.range as { start?: string; end?: string } | undefined;
    const txCount = typeof obj.transactionCount === "number" ? obj.transactionCount : undefined;
    return (
      <div className="mt-2 p-2.5 rounded-lg bg-[#EAE8E1] border border-border flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted mr-1">Query Result</span>
        {range && (
          <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono text-muted">
            {range.start} → {range.end}
          </span>
        )}
        {totals.income !== undefined && (
          <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono font-medium text-[#1E7E34]">
            +{formatVND(Number(totals.income))}
          </span>
        )}
        {totals.expense !== undefined && (
          <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono font-medium text-ink">
            −{formatVND(Number(totals.expense))}
          </span>
        )}
        {txCount !== undefined && (
          <span className="text-[11px] text-muted">
            ({txCount} {txCount === 1 ? "transaction" : "transactions"} matched)
          </span>
        )}
      </div>
    );
  }

  if (obj.itemCount !== undefined) {
    return (
      <div className="mt-2 p-2 rounded-lg bg-[#EAE8E1] text-[11px] text-ink-2 font-mono flex items-center gap-2">
        <span className="font-semibold text-muted uppercase text-[10px]">Result:</span>
        <span>{String(obj.itemCount)} parsed item(s)</span>
      </div>
    );
  }

  if (obj.matchCount !== undefined) {
    return (
      <div className="mt-2 p-2 rounded-lg bg-[#EAE8E1] text-[11px] text-ink-2 font-mono flex items-center gap-2">
        <span className="font-semibold text-muted uppercase text-[10px]">Result:</span>
        <span>{String(obj.matchCount)} matching transaction(s) found</span>
      </div>
    );
  }

  return null;
}

function ParametersTable({ rawParams }: { rawParams: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawParams);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) return null;
    return (
      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-[11px] font-mono border-collapse">
          <thead>
            <tr className="bg-[#EFECE6] text-ink-2 border-b border-border">
              <th className="px-2.5 py-1.5 font-semibold text-muted text-[10px] uppercase tracking-wider">Parameter</th>
              <th className="px-2.5 py-1.5 font-semibold text-muted text-[10px] uppercase tracking-wider">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-row">
            {entries.map(([key, val]) => (
              <tr key={key} className="hover:bg-[#F9F8F5]">
                <td className="px-2.5 py-1.5 text-ink font-medium select-all">{key}</td>
                <td className="px-2.5 py-1.5 text-accent-strong select-all">{typeof val === "object" ? JSON.stringify(val) : String(val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="mt-1.5 px-3 py-2 rounded-lg bg-[#EFECE6] text-[11px] font-mono text-ink-2 break-all">
      <span className="font-semibold text-muted select-none">PARAMS: </span>
      <span>{rawParams}</span>
    </div>
  );
}

function TracePanel({ entries }: { entries: TraceEntry[] }) {
  const sqlCount = entries.filter((entry) => entry.kind === "sql").length;
  return (
    <details className="group rounded-xl border border-border bg-[#F8F7F2] overflow-hidden">
      <summary className="flex items-center gap-2 px-3.5 py-3 text-[13px] font-medium text-ink-2 cursor-pointer select-none hover:bg-[#F1EFE8]">
        <Sparkles size={15} className="text-accent" />
        <span>Steps &amp; SQL</span>
        <span className="text-muted font-normal">{entries.length - sqlCount} steps · {sqlCount} queries</span>
      </summary>
      <div className="border-t border-border divide-y divide-border">
        {entries.map((entry, index) => (
          <div key={`${entry.kind}-${index}`} className="px-3.5 py-3">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
              {entry.kind === "sql" ? <Database size={14} className="text-accent" /> : <Check size={14} className="text-accent" />}
              <span>{entry.title}</span>
            </div>
            {entry.detail && <p className="mt-1 mb-0 text-xs text-muted">{entry.detail}</p>}
            {entry.data && <StepDataPreview data={entry.data} />}
            {entry.sql && (
              <div className="mt-2 flex flex-col gap-2">
                {entry.inlinedSql && (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Executed Query (With Parameters)</span>
                    <pre className="mt-1 mb-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#17211B] p-3 text-[11px] leading-relaxed text-[#E6F1E9]">
                      <code>{entry.inlinedSql}</code>
                    </pre>
                  </div>
                )}
                {(!entry.inlinedSql || entry.inlinedSql !== entry.sql) && (
                  <div>
                    {entry.inlinedSql && <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">SQL Template</span>}
                    <pre className="mt-1 mb-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#17211B] p-3 text-[11px] leading-relaxed text-[#A2B8A6]">
                      <code>{entry.sql}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
            {entry.parameters && <ParametersTable rawParams={entry.parameters} />}
          </div>
        ))}
        <p className="m-0 px-3.5 py-2.5 text-[11px] text-muted">These are system actions, not the model&apos;s private reasoning. SQL queries and parameter tables are shown above.</p>
      </div>
    </details>
  );
}

function CandidateCard({
  candidate, onSelect, disabled,
}: { candidate: TransactionDto; onSelect: () => void; disabled?: boolean }) {
  const amount = formatNumber(Number(candidate.amount));
  const sign = candidate.direction === "income" ? "+" : "−";
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="w-full flex items-center justify-between gap-3 bg-surface border border-border-input rounded-[14px] px-4.5 py-3.5 text-left cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{candidate.description}</span>
        <span className="text-[13px] text-muted">
          {CATEGORY_LABELS[candidate.category]} · {candidate.occurredDate} · {candidate.occurredTime}
        </span>
      </div>
      <span className="font-mono font-medium">
        {sign}
        {amount} ₫
      </span>
    </button>
  );
}

const DRAFT_FIELD = "min-w-0 border border-border-input rounded-[10px] bg-surface px-2.5 min-h-10 text-ink outline-none transition-colors duration-150 focus:border-accent";
const DRAFT_INPUT = `w-full ${DRAFT_FIELD}`;

function ProposalCard({
  proposal,
  state,
  onConfirm,
  onDiscard,
}: {
  proposal: ProposalDto;
  state: ConfirmState[string];
  onConfirm: (edits: api.DraftFields | null) => void;
  onDiscard: () => void;
}) {
  // After a failed confirm the owner can still fix the fields and try again.
  const showActions = !state || state === "error";
  const editable = showActions && isEditableDraft(proposal);
  const [description, setDescription] = useState(proposal.description);
  const [amount, setAmount] = useState(proposal.amount ?? "");
  const [direction, setDirection] = useState<"income" | "expense">(proposal.direction);
  const [category, setCategory] = useState<Category>(proposal.category);
  const [occurredDate, setOccurredDate] = useState(proposal.occurredDate ?? "");
  const [occurredTime, setOccurredTime] = useState(proposal.occurredTime);
  const timeTouched = occurredTime !== proposal.occurredTime;
  const dirty = description.trim() !== proposal.description || amount !== (proposal.amount ?? "")
    || direction !== proposal.direction || category !== proposal.category
    || occurredDate !== (proposal.occurredDate ?? "") || timeTouched;
  const validAmount = /^[1-9][0-9]{0,17}$/.test(amount);
  const canConfirm = editable ? validAmount && occurredDate !== "" && description.trim() !== "" : proposal.canConfirm;
  const sign = direction === "income" ? "+" : "−";
  const today = appLocalISODate(new Date());

  function confirm() {
    if (!dirty) {
      onConfirm(null);
      return;
    }
    onConfirm({
      amount, currency: "VND", direction, description: description.trim(), category,
      occurredDate: occurredDate || null,
      // An untouched default clock stays a default for its period; a picked clock becomes explicit.
      occurredTime: timeTouched || proposal.timeSource === "explicit" ? occurredTime : null,
      period: timeTouched ? null : proposal.period,
    });
  }

  return (
    <article className="bg-surface border border-border rounded-2xl overflow-hidden shadow-[0_8px_24px_-20px_rgba(22,32,26,0.28)]">
      <header className="flex items-center justify-between gap-3 border-b border-border-row bg-[#FCFBF8] px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-accent-strong">
          <Receipt size={15} />
          <span>Draft preview</span>
        </div>
        <span className="rounded-full border border-accent-soft-border bg-accent-soft-bg px-2.5 py-1 text-[11px] font-medium text-accent-strong">
          {editable ? "Edit, then confirm" : "Review before saving"}
        </span>
      </header>
      <dl className="m-0 grid grid-cols-2 gap-px bg-border-row p-px">
        <div className="col-span-2 bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
            <label htmlFor={`draft-desc-${proposal.id}`}>Description</label>
          </dt>
          <dd className="mt-1 mb-0 font-semibold text-ink">
            {editable ? (
              <input id={`draft-desc-${proposal.id}`} value={description} maxLength={200}
                onChange={(e) => setDescription(e.target.value)} className={`${DRAFT_INPUT} font-semibold`} />
            ) : (proposal.description || "Not provided")}
          </dd>
        </div>
        <div className={`bg-surface px-4 py-3 ${editable ? "col-span-2 sm:col-span-1" : ""}`}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
            <label htmlFor={`draft-amount-${proposal.id}`}>Amount</label>
          </dt>
          <dd className="mt-1 mb-0 font-mono text-lg font-semibold text-ink">
            {editable ? (
              <div className="flex gap-1.5">
                <select aria-label="Type" value={direction}
                  onChange={(e) => setDirection(e.target.value as "income" | "expense")}
                  className={`${DRAFT_FIELD} shrink-0 font-sans text-sm`}>
                  <option value="expense">− Expense</option>
                  <option value="income">+ Income</option>
                </select>
                <input id={`draft-amount-${proposal.id}`} inputMode="numeric" autoComplete="off"
                  value={amount ? formatNumber(Number(amount)) : ""}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, "").replace(/^0+/, "").slice(0, 18))}
                  aria-invalid={!validAmount}
                  className={`${DRAFT_INPUT} font-mono text-base`} placeholder="0" />
              </div>
            ) : `${sign}${proposal.amount ? formatNumber(Number(proposal.amount)) : "?"} ₫`}
          </dd>
        </div>
        <div className={`bg-surface px-4 py-3 ${editable ? "col-span-2 sm:col-span-1" : ""}`}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">
            <label htmlFor={`draft-cat-${proposal.id}`}>Category</label>
          </dt>
          <dd className="mt-1 mb-0 text-sm font-medium text-ink">
            {editable ? (
              <select id={`draft-cat-${proposal.id}`} value={category}
                onChange={(e) => setCategory(e.target.value as Category)} className={DRAFT_INPUT}>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            ) : CATEGORY_LABELS[proposal.category]}
          </dd>
        </div>
        <div className="col-span-2 bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Date &amp; time</dt>
          <dd className="mt-1 mb-0 text-sm text-ink-2">
            {editable ? (
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" aria-label="Date" value={occurredDate} max={today}
                  onChange={(e) => setOccurredDate(e.target.value)}
                  aria-invalid={occurredDate === ""} className={DRAFT_FIELD} />
                <input type="time" aria-label="Time" value={occurredTime}
                  onChange={(e) => setOccurredTime(e.target.value || proposal.occurredTime)}
                  className={DRAFT_FIELD} />
                {!timeTouched && proposal.timeSource === "default" && (
                  <span className="text-xs text-muted">default time for {proposal.period}</span>
                )}
              </div>
            ) : (
              <>{proposal.occurredDate ?? "Date missing"} · {proposal.period ? `${proposal.period} ` : ""}{proposal.occurredTime} · {proposal.timeSource}</>
            )}
          </dd>
        </div>
      </dl>
      <div className="px-4 py-3.5">
        {state === "error" && <p role="alert" className="m-0 mb-2 text-sm text-danger">Could not confirm.</p>}
        {showActions && (canConfirm ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={editable ? confirm : () => onConfirm(null)}
              className="font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-accent-strong"
            >
              {state === "error" ? "Try again" : dirty ? "Save & confirm" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="font-medium text-sm bg-transparent text-ink-3 border-0 rounded-[10px] px-3 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
            >
              Discard
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-sm text-muted">
              {editable
                ? !occurredDate ? "Pick a date (or tell me in chat) to confirm." : "Enter a valid amount and description to confirm."
                : "Missing date — ask a follow-up to add it before confirming."}
            </p>
            <button
              type="button"
              onClick={onDiscard}
              className="font-medium text-sm bg-transparent text-ink-3 border-0 rounded-[10px] px-3 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
            >
              Discard
            </button>
          </div>
        ))}
        {state === "pending" && <p className="m-0 text-sm text-muted">Confirming…</p>}
        {state === "discarding" && <p className="m-0 text-sm text-muted">Discarding…</p>}
        {state === "discarded" && <p className="m-0 text-sm text-muted">Discarded</p>}
        {state === "discard_error" && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="m-0 text-sm text-danger">Could not discard this draft.</p>
            <button
              type="button"
              onClick={onDiscard}
              className="font-semibold text-sm bg-surface border border-border-input rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC]"
            >
              Try again
            </button>
          </div>
        )}
        {state && typeof state === "object" && (
          <div className="flex items-center gap-2.5 text-sm text-accent-strong">
            <Check size={16} strokeWidth={2.4} />
            <span>Saved</span>
          </div>
        )}
      </div>
    </article>
  );
}
