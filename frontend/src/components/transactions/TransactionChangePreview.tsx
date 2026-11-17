"use client";

import { formatVND } from "@/lib/format";
import * as api from "@/lib/api";
import type { TransactionDto } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/api";

export type ChangeAction = "edit" | "delete" | "undo";
export type PendingChange = {
  proposal: api.ProposalDto;
  action: ChangeAction;
  original: TransactionDto;
  confirmKey: string;
  discardKey: string;
};

export function TransactionChangePreview({
  pending,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  pending: PendingChange;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const labels: Record<ChangeAction, { title: string; confirm: string; explanation: string }> = {
    edit: {
      title: "Review transaction changes",
      confirm: "Confirm edit",
      explanation: "The transaction will change only after you confirm this preview.",
    },
    delete: {
      title: "Review transaction deletion",
      confirm: "Confirm delete",
      explanation: "This transaction will be soft deleted and can be restored with Undo.",
    },
    undo: {
      title: "Review transaction restoration",
      confirm: "Confirm undo",
      explanation: "The deleted transaction will be restored only after you confirm.",
    },
  };
  const { proposal, action } = pending;
  const label = labels[action];

  return (
    <div className="fixed inset-0 bg-ink/40 z-30 flex items-center justify-center px-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-change-title"
        className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 w-full max-w-[480px]"
      >
        <div>
          <h2 id="transaction-change-title" className="m-0 text-base font-semibold">{label.title}</h2>
          <p className="m-0 mt-1 text-sm text-muted">{label.explanation}</p>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-3 rounded-xl bg-[#F6F5F0] p-4 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-muted">Description</dt>
            <dd className="m-0 mt-1 font-medium">{proposal.description || "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Amount</dt>
            <dd className="m-0 mt-1 font-mono">{proposal.amount ? formatVND(Number(proposal.amount) * (proposal.direction === "income" ? 1 : -1)) : "Missing"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Category</dt>
            <dd className="m-0 mt-1">{CATEGORY_LABELS[proposal.category]}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted">Date &amp; time</dt>
            <dd className="m-0 mt-1">{proposal.occurredDate ?? "Date missing"} · {proposal.occurredTime}</dd>
          </div>
        </dl>
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="font-medium text-sm bg-transparent text-ink-3 border border-border-input rounded-[10px] px-3.5 min-h-11 cursor-pointer disabled:opacity-50"
          >
            {busy ? "Please wait…" : "Cancel draft"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !proposal.canConfirm}
            className="font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer disabled:opacity-50"
          >
            {busy ? "Saving…" : label.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
