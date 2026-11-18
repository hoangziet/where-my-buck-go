"use client";

import { X } from "lucide-react";
import type { TransactionDto } from "@/lib/api";
import { formatVND } from "@/lib/format";
import { useEscapeKey } from "@/lib/use-escape-key";

interface Props {
  date: string;
  transactions: TransactionDto[];
  onClose: () => void;
  onSelect: (transaction: TransactionDto) => void;
}

export function CalendarDayModal({ date, transactions, onClose, onSelect }: Props) {
  useEscapeKey(onClose);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="calendar-day-title"
        className="flex max-h-[80vh] w-full max-w-[440px] flex-col rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="calendar-day-title" className="m-0 text-lg font-semibold">Transactions on {date}</h2>
          <button type="button" aria-label="Close day transactions" onClick={onClose}
            className="rounded-lg p-2 text-ink-3 hover:bg-[#F4F2EC]"><X size={18} /></button>
        </div>
        <div className="mt-4 overflow-y-auto">
          {transactions.map((transaction) => (
            <button key={transaction.id} type="button" onClick={() => onSelect(transaction)}
              className="flex w-full items-center justify-between gap-3 border-t border-border-row px-1 py-3 text-left hover:bg-[#F8F7F2]">
              <span className="min-w-0 truncate">{transaction.description}</span>
              <span className="shrink-0 font-mono text-sm">{formatVND(Number(transaction.amount) * (transaction.direction === "income" ? 1 : -1))}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
