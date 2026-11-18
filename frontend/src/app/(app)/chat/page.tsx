"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Paperclip, Camera, ArrowUp, Receipt, Bookmark, PanelLeft } from "lucide-react";
import { ChatSidebar } from "@/components/ChatSidebar";
import * as api from "@/lib/api";
import type { ChatHistoryItem, ProposalDto, TraceEntry, TransactionDto } from "@/lib/api";
import { FormattedMessage } from "@/components/chat/FormattedMessage";
import { AiMessage, CandidateCard, RefreshRangeDataButton, UserBubble } from "@/components/chat/MessageParts";
import { ProposalCard } from "@/components/chat/ProposalCard";
import { StarterQuestions } from "@/components/chat/StarterQuestions";
import { TracePanel } from "@/components/chat/TracePanel";
import {
  MAX_PENDING_DRAFTS,
  draftSummary,
  isEditableDraft,
  messageProposals,
  removeProposals,
  replaceProposal,
  type AssistantMessage,
  type ConfirmState,
  type Message,
} from "@/components/chat/messages";

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
  // On phones the sidebar is an overlay; start with it closed so the conversation is visible.
  // This page renders on the client only (useSearchParams behind Suspense), so window is available.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches,
  );
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
          ? { role: "user", text: m.text, imageEvidenceId: m.evidenceId ?? undefined }
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

  async function handleSend(suggestion?: string) {
    const text = (suggestion ?? input).trim();
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
          <span className="flex-1" />
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
          {messages.length === 0 && !chatId && !sending && <StarterQuestions onAsk={handleSend} />}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserBubble key={i} imagePreviewUrl={m.imagePreviewUrl} imageEvidenceId={m.imageEvidenceId}>{m.text}</UserBubble>
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
