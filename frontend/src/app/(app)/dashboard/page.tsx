"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Bookmark, X } from "lucide-react";
import { formatVND, formatNumber } from "@/lib/format";
import * as api from "@/lib/api";
import type { Category, PinDto, ReportsSummary, TransactionDto } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const CATEGORY_COLORS: Record<Category, string> = {
  housing: "#14502F",
  food_drink: "#1F6B44",
  bills: "#4E9A6E",
  shopping: "#7DBA94",
  transport: "#A9D3B8",
  entertainment: "#D5E9DC",
  income: "#8FD3AA",
  other: "#C9CEC9",
};

export default function DashboardPage() {
  const { username } = useAuth();
  const [summary, setSummary] = useState<ReportsSummary | null>(null);
  const [currentMonth, setCurrentMonth] = useState<ReportsSummary | null>(null);
  const [transactions, setTransactions] = useState<TransactionDto[]>([]);
  const [pins, setPins] = useState<PinDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.reportsSummary(6), api.reportsSummary(1), api.listTransactions(), api.listPins()])
      .then(([six, one, tx, pinned]) => {
        setSummary(six);
        setCurrentMonth(one);
        setTransactions(tx.items);
        setPins(pinned.items);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, []);

  async function handleUnpin(id: string) {
    try {
      await api.deletePin(id);
      setPins((prev) => prev.filter((p) => p.id !== id));
    } catch {
      /* non-critical convenience action */
    }
  }

  const income = Number(currentMonth?.totals.income ?? 0);
  const expense = Number(currentMonth?.totals.expense ?? 0);
  const balance = useMemo(
    () => transactions.reduce((a, t) => a + (t.direction === "income" ? Number(t.amount) : -Number(t.amount)), 0),
    [transactions],
  );
  const savedPct = income > 0 ? Math.round(((income - expense) / income) * 100) : 0;
  const maxMonthly = useMemo(
    () => Math.max(1, ...((summary?.months ?? []).flatMap((m) => [Number(m.income), Number(m.expense)]))),
    [summary],
  );
  const recent = useMemo(() => [...transactions].slice(0, 5), [transactions]);
  const categorySpend = useMemo(() => {
    const entries = Object.entries(currentMonth?.categories ?? {}) as [Category, string][];
    return entries
      .map(([category, amount]) => ({ category, amount: Number(amount) }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [currentMonth]);
  const maxCategory = Math.max(1, ...categorySpend.map((c) => c.amount));
  const totalCategorySpend = categorySpend.reduce((a, c) => a + c.amount, 0);

  return (
    <main className="flex-1 flex flex-col gap-6 px-4 pb-28 pt-6 lg:px-10 lg:pt-8 lg:pb-12">
      {error && <p className="m-0 text-sm text-danger">{error}</p>}

      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Good to see you, {username}</span>
            <h1 className="m-0 font-display font-semibold text-[32px] tracking-tight">
              {new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}
            </h1>
          </div>
          <Link
            href="/chat"
            className="flex items-center gap-2 bg-accent text-white no-underline px-4 py-[11px] rounded-[10px] font-semibold text-sm transition-colors duration-150 hover:bg-accent-strong"
          >
            <Plus size={16} strokeWidth={2.2} />
            Add with AI
          </Link>
        </div>

        <AskBar />

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <KpiCard label="Balance" value={loading ? "…" : formatVND(balance)} sub="Last 200 transactions" />
          <KpiCard
            label="Income"
            value={loading ? "…" : formatVND(income)}
            sub="This month"
            valueClass="text-accent"
          />
          <KpiCard label="Expenses" value={loading ? "…" : formatVND(-expense)} sub="This month" />
          <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-2">
            <span className="text-[13px] text-muted">Saved this month</span>
            <span className="font-display font-semibold text-[28px] tracking-tight">{loading ? "…" : `${savedPct}%`}</span>
            <div className="h-1.5 bg-[#EFEDE6] rounded-full overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, savedPct))}%` }} />
            </div>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))" }}>
          <section className="bg-surface border border-border rounded-2xl p-[22px] flex flex-col gap-4.5">
            <div className="flex justify-between items-start gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-base font-semibold">Income vs expenses</h2>
                <span className="text-xs text-muted">Last {summary?.months.length ?? 6} months</span>
              </div>
              <div className="flex gap-3.5 text-xs text-ink-3">
                <Legend color="var(--color-accent)" label="Income" />
                <Legend color="var(--color-chart-light)" label="Expenses" />
              </div>
            </div>
            <div role="img" aria-label="Bar chart: income and expenses per month" className="flex flex-col gap-2">
              <div
                className="h-[210px] grid gap-3 items-end border-b border-border"
                style={{
                  gridTemplateColumns: `repeat(${summary?.months.length || 1}, minmax(0, 1fr))`,
                  backgroundImage: "linear-gradient(#F1EFE9 1px, transparent 1px)",
                  backgroundSize: "100% 52px",
                }}
              >
                {(summary?.months ?? []).map((m) => (
                  <div key={m.month} className="flex gap-1 items-end justify-center h-full">
                    <div
                      className="w-[40%] max-w-[22px] bg-accent rounded-t"
                      style={{ height: `${Math.round((Number(m.income) / maxMonthly) * 196)}px` }}
                    />
                    <div
                      className="w-[40%] max-w-[22px] bg-chart-light rounded-t"
                      style={{ height: `${Math.round((Number(m.expense) / maxMonthly) * 196)}px` }}
                    />
                  </div>
                ))}
              </div>
              <div
                className="grid gap-3 text-xs text-muted text-center"
                style={{ gridTemplateColumns: `repeat(${summary?.months.length || 1}, minmax(0, 1fr))` }}
              >
                {(summary?.months ?? []).map((m) => (
                  <span key={m.month}>{m.month.slice(5)}</span>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-surface border border-border rounded-2xl p-[22px] flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-base font-semibold">Spending by category</h2>
              <span className="text-xs text-muted">This month · {formatNumber(totalCategorySpend)} ₫</span>
            </div>
            <div className="flex flex-col gap-3">
              {categorySpend.length === 0 && !loading && <span className="text-sm text-muted">No expenses yet this month.</span>}
              {categorySpend.map((c) => (
                <div key={c.category} className="grid gap-3 items-center text-sm" style={{ gridTemplateColumns: "120px minmax(0,1fr) 110px" }}>
                  <span>{CATEGORY_LABELS[c.category]}</span>
                  <div className="h-2 bg-border-row rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(c.amount / maxCategory) * 100}%`, background: CATEGORY_COLORS[c.category] }}
                    />
                  </div>
                  <span className="font-mono text-[13px] text-right">{formatNumber(c.amount)} ₫</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {pins.length > 0 && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {pins.map((p) => (
              <PinCard key={p.id} pin={p} onUnpin={() => handleUnpin(p.id)} />
            ))}
          </div>
        )}

        <section className="bg-surface border border-border rounded-2xl p-[22px] flex flex-col gap-2.5">
          <div className="flex justify-between items-center">
            <h2 className="m-0 text-base font-semibold">Recent transactions</h2>
            <Link href="/transactions" className="text-sm font-medium no-underline transition-colors duration-150 hover:text-accent-strong">
              View all
            </Link>
          </div>
          {recent.length === 0 && !loading && <span className="text-sm text-muted py-2">No transactions yet.</span>}
          {recent.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg border-b border-border-row last:border-0 transition-colors duration-150 hover:bg-[#F8F7F2]"
            >
              <span className="w-9 h-9 rounded-[10px] bg-[#F4F2EC] flex items-center justify-center text-xs font-semibold text-ink-3">
                {t.description.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="font-medium truncate">{t.description}</span>
                <span className="text-xs text-muted">
                  {CATEGORY_LABELS[t.category]} · {t.occurredDate} {t.occurredTime}
                </span>
              </div>
              <span className={`font-mono text-sm font-medium ${t.direction === "income" ? "text-accent" : "text-ink"}`}>
                {formatVND(t.direction === "income" ? Number(t.amount) : -Number(t.amount))}
              </span>
            </div>
          ))}
        </section>
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="lg:hidden flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[13px] text-muted">Good to see you, {username}</span>
            <h1 className="m-0 font-display font-semibold text-2xl tracking-tight">
              {new Date().toLocaleString("en-US", { month: "long" })}
            </h1>
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className="w-10 h-10 rounded-full bg-[#E3EDE6] text-accent-strong flex items-center justify-center font-semibold text-sm no-underline"
          >
            {(username ?? "?").slice(0, 2).toUpperCase()}
          </Link>
        </div>

        <div className="bg-ink text-white rounded-[20px] p-5 flex flex-col gap-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-[#C9CEC9]">Balance</span>
            <span className="font-display font-semibold text-[32px] tracking-tight">{loading ? "…" : formatVND(balance)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-white/[0.08] rounded-xl px-3 py-2.5 flex flex-col">
              <span className="text-xs text-[#C9CEC9]">Income</span>
              <span className="font-mono text-sm text-[#8FD3AA]">{loading ? "…" : formatNumber(income)}</span>
            </div>
            <div className="bg-white/[0.08] rounded-xl px-3 py-2.5 flex flex-col">
              <span className="text-xs text-[#C9CEC9]">Expenses</span>
              <span className="font-mono text-sm">{loading ? "…" : formatNumber(expense)}</span>
            </div>
          </div>
        </div>

        <AskBar mobile />

        <section className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="m-0 text-[15px] font-semibold">Spending by category</h2>
          {categorySpend.length === 0 && !loading && <span className="text-sm text-muted">No expenses yet this month.</span>}
          {categorySpend.length > 0 && (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5">
                {categorySpend.map((c) => (
                  <div
                    key={c.category}
                    className="h-full"
                    style={{ width: `${(c.amount / totalCategorySpend) * 100}%`, background: CATEGORY_COLORS[c.category] }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                {categorySpend.map((c) => (
                  <span key={c.category} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm" style={{ background: CATEGORY_COLORS[c.category] }} />
                    {CATEGORY_LABELS[c.category]} · {(c.amount / 1_000_000).toFixed(1)}M
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="bg-surface border border-border rounded-2xl px-4 py-1.5 flex flex-col">
          <div className="flex justify-between items-center py-2">
            <h2 className="m-0 text-[15px] font-semibold">Recent</h2>
            <Link href="/transactions" className="text-[13px] font-medium no-underline py-2 transition-colors duration-150 hover:text-accent-strong">
              See all
            </Link>
          </div>
          {recent.slice(0, 3).map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 py-2.5 px-2 -mx-2 rounded-lg border-t border-border-row transition-colors duration-150 active:bg-[#F8F7F2]">
              <span className="w-[34px] h-[34px] rounded-[10px] bg-[#F4F2EC] flex items-center justify-center text-[11px] font-semibold text-ink-3">
                {t.description.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 flex flex-col">
                <span className="font-medium text-sm truncate">{t.description}</span>
                <span className="text-xs text-muted">
                  {t.occurredDate} · {t.occurredTime}
                </span>
              </div>
              <span className="font-mono text-[13px]">{formatVND(t.direction === "income" ? Number(t.amount) : -Number(t.amount))}</span>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

function AskBar({ mobile = false }: { mobile?: boolean }) {
  return (
    <Link
      href="/chat"
      className={`flex items-center gap-3 bg-surface border border-border rounded-2xl no-underline text-muted transition-colors duration-150 hover:border-accent-soft-border hover:bg-accent-soft-bg ${
        mobile ? "px-3.5 min-h-12" : "px-4.5 py-3.5"
      }`}
    >
      <svg aria-hidden="true" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      <span className="flex-1 text-[14px]">
        {mobile ? "Ask or log anything…" : 'Ask or log anything — "how much did I spend on coffee this month?"'}
      </span>
    </Link>
  );
}

function KpiCard({
  label,
  value,
  sub,
  valueClass = "",
}: {
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-2">
      <span className="text-[13px] text-muted">{label}</span>
      <span className={`font-display font-semibold text-[28px] tracking-tight ${valueClass}`}>{value}</span>
      <span className="text-[13px] text-ink-3">{sub}</span>
    </div>
  );
}

function PinCard({ pin, onUnpin }: { pin: PinDto; onUnpin: () => void }) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-2.5">
      <div className="flex justify-between items-start gap-2">
        <span className="text-[13px] text-muted flex items-center gap-1.5 truncate">
          <Bookmark size={12} className="shrink-0" />
          {pin.title}
        </span>
        <button
          type="button"
          aria-label="Unpin"
          onClick={onUnpin}
          className="w-7 h-7 shrink-0 rounded-lg text-ink-3 border-0 bg-transparent cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
        >
          <X size={14} className="mx-auto" />
        </button>
      </div>
      <div className="flex gap-4">
        <div className="flex flex-col">
          <span className="text-xs text-muted">Income</span>
          <span className="font-mono text-sm text-accent">{formatNumber(Number(pin.totals.income))}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted">Expenses</span>
          <span className="font-mono text-sm">{formatNumber(Number(pin.totals.expense))}</span>
        </div>
      </div>
      <span className="text-[11px] text-muted">
        {pin.start} → {pin.end}
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}
