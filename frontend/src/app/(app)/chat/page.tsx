"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Check, Paperclip, Camera, ArrowUp, ArrowLeft, Receipt, Bookmark, Database, Sparkles } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { formatNumber } from "@/lib/format";
import * as api from "@/lib/api";
import type { ChatHistoryItem, ProposalDto, TraceEntry, TransactionDto } from "@/lib/api";
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
  | { kind: "text"; text: string; history: ChatHistoryItem[]; chatId?: string; idempotencyKey: string }
  | { kind: "image"; file: File; caption: string; idempotencyKey: string };

type ConfirmState = Record<
  string,
  { transactionId: string } | "discarded" | "error" | "pending" | "discarding" | "discard_error"
>;

const MAX_IMAGE_BYTES = 4_000_000;

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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({});
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());
  const [selectingIds, setSelectingIds] = useState<Set<string>>(new Set());
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
    const previousRetry = retryRequest.current;
    const request = previousRetry?.kind === "text"
      && previousRetry.text === text
      && previousRetry.chatId === chatId
      && JSON.stringify(previousRetry.history) === JSON.stringify(history)
      ? previousRetry
      : { kind: "text" as const, text, history, chatId, idempotencyKey: crypto.randomUUID() };
    const isRetry = request === previousRetry;
    if (!isRetry) setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setSending(true);
    try {
      const res = await api.sendChatMessage(text, request.history, request.chatId, request.idempotencyKey);
      if (res.chatId && res.chatId !== chatId) {
        setChatId(res.chatId);
        ownedChatId.current = res.chatId;
        router.replace(`/chat?id=${res.chatId}`);
      }
      let assistant: AssistantMessage;
      const historyText = res.message;
      if (res.kind === "qa") {
        assistant = { role: "assistant", kind: "qa", text: res.message, start: res.start, end: res.end };
      } else if (res.kind === "intake") {
        assistant = { role: "assistant", kind: "intake", text: res.message, proposals: res.proposals, errors: res.errors };
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
      setMessages((prev) => [...prev, assistant]);
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
      ? previousRetry
      : { kind: "image" as const, file, caption, idempotencyKey: crypto.randomUUID() };
    const isRetry = request === previousRetry;
    setInput("");
    setPendingImage(null);
    setPendingImageUrl(null);
    if (!isRetry) setMessages((prev) => [...prev, { role: "user", text: caption, imagePreviewUrl: previewUrl }]);
    setSending(true);
    try {
      const res = await api.imageIntake(file, caption || undefined, request.idempotencyKey);
      setMessages((prev) => [...prev, {
        role: "assistant", kind: "image_intake", text: res.message, proposal: res.proposal,
        debugTrace: res.debugTrace,
      }]);
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

  async function handleConfirm(proposal: ProposalDto) {
    const existing = confirmState[proposal.id];
    if (existing && existing !== "error") return;
    setConfirmState((prev) => ({ ...prev, [proposal.id]: "pending" }));
    try {
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
    <main className="flex-1 flex flex-col min-h-screen lg:min-h-0">
      <header className="lg:hidden flex items-center gap-2 px-3 py-3 border-b border-border-nav bg-surface sticky top-0 z-20">
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          className="w-11 h-11 flex items-center justify-center text-ink rounded-lg transition-colors duration-150 active:bg-[#F4F2EC]"
        >
          <ArrowLeft size={20} />
        </Link>
        <span className="flex-1 font-semibold text-base">AI Chat</span>
        <button
          type="button"
          aria-label="New chat"
          onClick={startNewChat}
          className="w-11 h-11 border-0 bg-transparent text-ink rounded-lg cursor-pointer transition-colors duration-150 active:bg-[#F4F2EC]"
        >
          <Plus size={20} />
        </button>
      </header>

      <div className="flex-1 px-4 lg:px-8 pb-40 lg:pb-8 flex flex-col">
        <div className="w-full max-w-[860px] mx-auto flex flex-col gap-7">
          <div className="hidden lg:flex flex-wrap items-center justify-between gap-3 py-5.5 border-b border-border-nav">
            <h1 className="m-0 text-[17px] font-semibold">AI Chat</h1>
            <button
              type="button"
              onClick={startNewChat}
              className="flex items-center gap-2 bg-surface border border-border-input rounded-[10px] px-3.5 min-h-10 text-sm font-medium cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC]"
            >
              <Plus size={16} strokeWidth={2} />
              New chat
            </button>
          </div>

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
                    <p className="m-0">{m.text}</p>
                    {m.start && m.end && (
                      <button
                        type="button"
                        onClick={() => handlePin(i, m.text, m.start!, m.end!)}
                        disabled={pinnedIds.has(i)}
                        className={`self-start flex items-center gap-2 border rounded-[10px] px-3.5 min-h-9 text-[13px] font-medium cursor-pointer transition-colors duration-150 ${
                          pinnedIds.has(i)
                            ? "bg-accent-soft-bg text-accent-strong border-accent-soft-border"
                            : "bg-surface text-ink border-border-input hover:bg-[#F4F2EC]"
                        }`}
                      >
                        <Bookmark size={14} />
                        {pinnedIds.has(i) ? "Pinned to Dashboard" : "Pin to Dashboard"}
                      </button>
                    )}
                  </>
                )}
                {m.kind === "error" && <p role="alert" className="m-0 text-danger">{m.text}</p>}
                {m.kind === "stored" && <p className="m-0">{m.text}</p>}
                {m.kind === "needs_selection" && (
                  <>
                    <p className="m-0">{m.text}</p>
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
                    <p className="m-0">{m.text}</p>
                    <ProposalCard
                      proposal={m.proposal}
                      state={confirmState[m.proposal.id]}
                      onConfirm={() => handleConfirm(m.proposal)}
                      onDiscard={() => handleDiscard(m.proposal)}
                    />
                  </>
                )}
                {m.kind === "intake" && (
                  <>
                    <p className="m-0">{m.text}</p>
                    {m.proposals.map((p) => (
                      <ProposalCard
                        key={p.id}
                        proposal={p}
                        state={confirmState[p.id]}
                        onConfirm={() => handleConfirm(p)}
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
                      proposal={m.proposal}
                      state={confirmState[m.proposal.id]}
                      onConfirm={() => handleConfirm(m.proposal)}
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

      <div className="fixed bottom-0 left-0 right-0 lg:static lg:mt-2 px-4 pb-4 pt-2 lg:px-8 bg-bg lg:bg-transparent">
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
              className="text-[15px] border-0 outline-none resize-none bg-transparent text-ink px-0.5 py-1"
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
                  onClick={() => fileInput.current?.click()}
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
        <div className="bg-ink text-white px-4 py-3 rounded-[16px_16px_4px_16px]">{children}</div>
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
            {entry.sql && (
              <pre className="mt-2 mb-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#17211B] p-3 text-[11px] leading-relaxed text-[#E6F1E9]">
                <code>{entry.sql}</code>
              </pre>
            )}
          </div>
        ))}
        <p className="m-0 px-3.5 py-2.5 text-[11px] text-muted">These are system actions, not the model&apos;s private reasoning. SQL values are hidden.</p>
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

function ProposalCard({
  proposal,
  state,
  onConfirm,
  onDiscard,
}: {
  proposal: ProposalDto;
  state: ConfirmState[string];
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const amount = proposal.amount ? formatNumber(Number(proposal.amount)) : "?";
  const sign = proposal.direction === "income" ? "+" : "−";
  return (
    <article className="bg-surface border border-border rounded-2xl overflow-hidden shadow-[0_8px_24px_-20px_rgba(22,32,26,0.28)]">
      <header className="flex items-center justify-between gap-3 border-b border-border-row bg-[#FCFBF8] px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-accent-strong">
          <Receipt size={15} />
          <span>Draft preview</span>
        </div>
        <span className="rounded-full border border-accent-soft-border bg-accent-soft-bg px-2.5 py-1 text-[11px] font-medium text-accent-strong">Review before saving</span>
      </header>
      <dl className="m-0 grid grid-cols-2 gap-px bg-border-row p-px">
        <div className="col-span-2 bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Description</dt>
          <dd className="mt-1 mb-0 font-semibold text-ink">{proposal.description || "Not provided"}</dd>
        </div>
        <div className="bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Amount</dt>
          <dd className="mt-1 mb-0 font-mono text-lg font-semibold text-ink">{sign}{amount} ₫</dd>
        </div>
        <div className="bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Category</dt>
          <dd className="mt-1 mb-0 text-sm font-medium text-ink">{CATEGORY_LABELS[proposal.category]}</dd>
        </div>
        <div className="col-span-2 bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Date &amp; time</dt>
          <dd className="mt-1 mb-0 text-sm text-ink-2">
            {proposal.occurredDate ?? "Date missing"} · {proposal.period ? `${proposal.period} ` : ""}{proposal.occurredTime} · {proposal.timeSource}
          </dd>
        </div>
      </dl>
      <div className="px-4 py-3.5">
        {!state && proposal.canConfirm && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-accent-strong"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="font-medium text-sm bg-transparent text-ink-3 border-0 rounded-[10px] px-3 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
            >
              Discard
            </button>
          </div>
        )}
        {!state && !proposal.canConfirm && (
          <p className="m-0 text-sm text-muted">Missing date — ask a follow-up to add it before confirming.</p>
        )}
        {state === "pending" && <p className="m-0 text-sm text-muted">Confirming…</p>}
        {state === "discarding" && <p className="m-0 text-sm text-muted">Discarding…</p>}
        {state === "discarded" && <p className="m-0 text-sm text-muted">Discarded</p>}
        {state === "error" && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="m-0 text-sm text-danger">Could not confirm.</p>
            <button
              type="button"
              onClick={onConfirm}
              className="font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-accent-strong"
            >
              Try again
            </button>
          </div>
        )}
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
