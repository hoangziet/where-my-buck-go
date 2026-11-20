"use client";

import { useState } from "react";
import { Check, Receipt } from "lucide-react";
import { appLocalISODate, formatNumber } from "@/lib/format";
import type { Category, DraftFields, ProposalDto } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/api";
import { isEditableDraft, type ConfirmState } from "./messages";
import { useAuth } from "@/lib/auth-context";

const DRAFT_FIELD = "min-w-0 border border-border-input rounded-[10px] bg-surface px-2.5 min-h-10 text-ink outline-none transition-colors duration-150 focus:border-accent";

const DRAFT_INPUT = `w-full ${DRAFT_FIELD}`;

export function ProposalCard({
  proposal,
  state,
  onConfirm,
  onDiscard,
}: {
  proposal: ProposalDto;
  state: ConfirmState[string];
  onConfirm: (edits: DraftFields | null) => void;
  onDiscard: () => void;
}) {
  const { salaryModeEnabled } = useAuth();
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

  if (proposal.category === "salary" && !salaryModeEnabled) {
    return <aside className="rounded-xl border border-border-row bg-surface px-4 py-3 text-sm text-muted">
      Salary draft hidden. Enable salary mode in Settings to view it.
    </aside>;
  }

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
                {Object.entries(CATEGORY_LABELS).filter(([value]) => value !== "salary" || salaryModeEnabled).map(([value, label]) => (
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
