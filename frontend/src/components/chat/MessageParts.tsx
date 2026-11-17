"use client";

import { useState } from "react";
import { RotateCw } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { formatNumber, formatVND } from "@/lib/format";
import * as api from "@/lib/api";
import type { TransactionDto } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/api";

export function UserBubble({ children, imagePreviewUrl }: { children: React.ReactNode; imagePreviewUrl?: string }) {
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

export function AiMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5 items-start">
      <LogoMark size={30} />
      <div className="flex-1 min-w-0 flex flex-col gap-3">{children}</div>
    </div>
  );
}

export function RefreshRangeDataButton({ start, end }: { start: string; end: string }) {
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

export function CandidateCard({
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
