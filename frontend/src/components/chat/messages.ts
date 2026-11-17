import type { ProposalDto, TraceEntry, TransactionDto } from "@/lib/api";

export type AssistantMessage = (
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

export type Message = { role: "user"; text: string; imagePreviewUrl?: string } | AssistantMessage;

export type ConfirmState = Record<
  string,
  { transactionId: string } | "discarded" | "error" | "pending" | "discarding" | "discard_error"
>;

export const MAX_PENDING_DRAFTS = 5;

export function messageProposals(m: Message): ProposalDto[] {
  if (m.role !== "assistant") return [];
  if (m.kind === "intake") return m.proposals;
  if (m.kind === "change" || m.kind === "image_intake") return [m.proposal];
  return [];
}

export function isEditableDraft(p: ProposalDto): boolean {
  return p.state === "draft" && (p.operation === "create" || p.operation === "edit");
}

/** Short, model-readable summary so a follow-up message can refer back to these drafts. */
export function draftSummary(p: ProposalDto): string {
  const amount = p.amount ? `${p.direction === "income" ? "+" : "-"}${p.amount} VND` : "amount missing";
  const when = `${p.occurredDate ?? "date missing"} ${p.period} ${p.occurredTime} (${p.timeSource})`;
  return `[Draft ${p.id}] ${p.description} · ${amount} · ${p.category} · ${when}`;
}

export function replaceProposal(messages: Message[], updated: ProposalDto): Message[] {
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
export function removeProposals(messages: Message[], ids: Set<string>): Message[] {
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
