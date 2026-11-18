"use client";

import { X } from "lucide-react";
import type { TransactionDto } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/api";
import { formatVND } from "@/lib/format";
import { useEscapeKey } from "@/lib/use-escape-key";

interface Props {
  transaction: TransactionDto;
  onClose: () => void;
  onEdit: () => void;
  onViewEvidence: () => void;
}

export function TransactionDetailsModal({ transaction, onClose, onEdit, onViewEvidence }: Props) {
  useEscapeKey(onClose);
  const amount = Number(transaction.amount) * (transaction.direction === "income" ? 1 : -1);
  const hasEvidence = Boolean(transaction.evidence?.length || transaction.evidenceIds?.length);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="transaction-details-title"
        className="w-full max-w-[440px] rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="m-0 text-xs font-medium uppercase tracking-wide text-muted">Transaction</p>
            <h2 id="transaction-details-title" className="m-0 mt-1 text-xl font-semibold">{transaction.description}</h2>
          </div>
          <button type="button" aria-label="Close transaction details" onClick={onClose}
            className="rounded-lg p-2 text-ink-3 hover:bg-[#F4F2EC]"><X size={18} /></button>
        </div>
        <p className={`my-5 font-mono text-2xl font-semibold ${transaction.direction === "income" ? "text-accent" : "text-ink"}`}>
          {formatVND(amount)}
        </p>
        <dl className="grid grid-cols-2 gap-4 border-y border-border-row py-4 text-sm">
          <div><dt className="text-muted">Date and time</dt><dd className="m-0 mt-1 font-medium">{transaction.occurredDate} {transaction.occurredTime}</dd></div>
          <div><dt className="text-muted">Category</dt><dd className="m-0 mt-1 font-medium">{CATEGORY_LABELS[transaction.category]}</dd></div>
          <div><dt className="text-muted">Type</dt><dd className="m-0 mt-1 font-medium capitalize">{transaction.direction}</dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={onEdit} className="rounded-lg bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent-strong">Edit transaction</button>
          {hasEvidence && <button type="button" onClick={onViewEvidence}
            className="rounded-lg border border-border-input px-4 py-2.5 font-medium hover:bg-[#F4F2EC]">View original evidence</button>}
        </div>
      </section>
    </div>
  );
}
