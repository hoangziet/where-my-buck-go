"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Trash2, Pencil, Eye, ChevronDown, SlidersHorizontal, CalendarDays, List } from "lucide-react";
import { appLocalISODate, appLocalTime, formatVND } from "@/lib/format";
import * as api from "@/lib/api";
import type { TransactionDto } from "@/lib/api";
import { ApiError, CATEGORY_LABELS, TRANSACTIONS_PAGE_LIMIT } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { TransactionFormModal, type TransactionFormValues } from "@/components/transactions/TransactionFormModal";
import { EvidenceModal } from "@/components/transactions/EvidenceModal";
import { TransactionDetailsModal } from "@/components/transactions/TransactionDetailsModal";
import { CalendarDayModal } from "@/components/transactions/CalendarDayModal";
import { ClearFiltersButton, RangeFilters, SearchInput, SortableHeader } from "@/components/transactions/TableControls";
import { TransactionChangePreview, type PendingChange } from "@/components/transactions/TransactionChangePreview";
import {
  DEFAULT_SORT,
  EMPTY_RANGE,
  SORT_LABELS,
  dayGroup,
  displayDate,
  downloadCsv,
  matchesRange,
  signedAmount,
  sortDirectionLabel,
  sortTransactions,
  type CategoryFilter,
  type RangeFilter,
  type Sort,
  type SortKey,
  type TypeFilter,
} from "@/components/transactions/table";

export default function TransactionsPage() {
  const { salaryModeEnabled } = useAuth();
  const today = appLocalISODate(new Date());
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [calendarView, setCalendarView] = useState(false);
  const [items, setItems] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [range, setRange] = useState<RangeFilter>(EMPTY_RANGE);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [lastDeleted, setLastDeleted] = useState<{ tx: TransactionDto; deletedVersion: number } | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [viewingEvidenceFor, setViewingEvidenceFor] = useState<TransactionDto | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<TransactionDto | null>(null);
  const [viewingDay, setViewingDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [undoing, setUndoing] = useState(false);
  const [changeRequestPending, setChangeRequestPending] = useState(false);

  useEffect(() => {
    api
      .listTransactions()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load transactions"))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const filtered = items.filter((t) => {
      if (typeFilter === "expense" && t.direction !== "expense") return false;
      if (typeFilter === "income" && t.direction !== "income") return false;
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (query && !t.description.toLowerCase().includes(query.toLowerCase())) return false;
      return matchesRange(t, range);
    });
    return sortTransactions(filtered, sort);
  }, [items, typeFilter, categoryFilter, query, range, sort]);

  const filtersActive = query !== "" || typeFilter !== "all" || categoryFilter !== "all"
    || Object.values(range).some(Boolean);

  function clearFilters() {
    setQuery("");
    setTypeFilter("all");
    setCategoryFilter("all");
    setRange(EMPTY_RANGE);
  }

  function applyCalendarMonth(month: string) {
    if (!month) return;
    setCalendarMonth(month);
    const [year, monthNumber] = month.split("-").map(Number);
    const start = `${month}-01`;
    const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    setRange((current) => ({ ...current, dateFrom: start, dateTo: end }));
  }

  const visibleTotal = visible.reduce((sum, t) => sum + signedAmount(t), 0);

  async function handleStaleVersion(err: unknown): Promise<boolean> {
    if (!(err instanceof ApiError) || err.status !== 409) return false;
    try {
      const res = await api.listTransactions();
      setItems(res.items);
    } catch {
      /* best-effort refresh; the error message below still guides the user */
    }
    setError("This transaction changed elsewhere. The list has been refreshed — please try again.");
    return true;
  }

  async function handleDelete(t: TransactionDto) {
    if (deletingIds.has(t.id) || pendingChange) return;
    setError(null);
    setDeletingIds((prev) => new Set(prev).add(t.id));
    try {
      const proposal = await api.proposeChange("delete", t.id, t.version, `Deleted "${t.description}" from Transactions page`);
      setPendingChange({
        proposal, action: "delete", original: t,
        confirmKey: crypto.randomUUID(), discardKey: crypto.randomUUID(),
      });
    } catch (err) {
      if (await handleStaleVersion(err)) return;
      setError(err instanceof Error ? err.message : "Failed to delete transaction");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(t.id);
        return next;
      });
    }
  }

  async function handleCreate(values: TransactionFormValues) {
    // Submitting the form is the owner's explicit confirmation, so the draft is confirmed at once.
    // Errors propagate to the form, which keeps the entered values and shows the message.
    const draft = await api.createTransactionDraft(values, `Added "${values.description}" from Transactions page`);
    const { transaction } = await api.confirmProposal(draft.id, draft.version, crypto.randomUUID());
    setItems((prev) => [transaction, ...prev]);
    setAdding(false);
  }

  async function handleEditSave(fields: TransactionFormValues) {
    if (!editing) return;
    setError(null);
    try {
      const original = editing;
      const proposal = await api.proposeChange(
        "edit", original.id, original.version, `Edited "${original.description}" from Transactions page`,
        { amount: fields.amount, currency: "VND", direction: fields.direction, description: fields.description,
          category: fields.category, occurredDate: fields.occurredDate, occurredTime: fields.occurredTime },
      );
      setPendingChange({
        proposal, action: "edit", original,
        confirmKey: crypto.randomUUID(), discardKey: crypto.randomUUID(),
      });
      setEditing(null);
    } catch (err) {
      if (await handleStaleVersion(err)) { setEditing(null); return; }
      setError(err instanceof Error ? err.message : "Failed to save changes");
    }
  }

  async function handleUndo() {
    if (!lastDeleted || undoing || pendingChange) return;
    setError(null);
    setUndoing(true);
    try {
      const { tx, deletedVersion } = lastDeleted;
      const proposal = await api.proposeChange(
        "undo",
        tx.id,
        deletedVersion,
        `Restored "${tx.description}" from Transactions page`,
      );
      setPendingChange({
        proposal, action: "undo", original: tx,
        confirmKey: crypto.randomUUID(), discardKey: crypto.randomUUID(),
      });
    } catch (err) {
      if (await handleStaleVersion(err)) { setLastDeleted(null); return; }
      setError(err instanceof Error ? err.message : "Failed to undo delete");
    } finally {
      setUndoing(false);
    }
  }

  async function handleConfirmChange() {
    if (!pendingChange || changeRequestPending) return;
    setError(null);
    setChangeRequestPending(true);
    try {
      const { transaction } = await api.confirmProposal(
        pendingChange.proposal.id, pendingChange.proposal.version, pendingChange.confirmKey,
      );
      if (pendingChange.action === "edit") {
        setItems((prev) => prev.map((item) => (item.id === transaction.id ? transaction : item)));
      } else if (pendingChange.action === "delete") {
        setItems((prev) => prev.filter((item) => item.id !== transaction.id));
        setLastDeleted({ tx: pendingChange.original, deletedVersion: transaction.version });
        setRevealedId(null);
      } else {
        setItems((prev) => [...prev, transaction].sort((a, b) => (a.occurredDate < b.occurredDate ? 1 : -1)));
        setLastDeleted(null);
      }
      setPendingChange(null);
    } catch (err) {
      if (await handleStaleVersion(err)) setPendingChange(null);
      else setError(err instanceof Error ? err.message : "Failed to apply this change");
    } finally {
      setChangeRequestPending(false);
    }
  }

  async function handleCancelChange() {
    if (!pendingChange || changeRequestPending) return;
    setError(null);
    setChangeRequestPending(true);
    try {
      await api.discardProposal(
        pendingChange.proposal.id, pendingChange.proposal.version, pendingChange.discardKey,
      );
      setPendingChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not discard this draft");
    } finally {
      setChangeRequestPending(false);
    }
  }

  const groups = useMemo(() => {
    const now = new Date();
    const today = appLocalISODate(now);
    const yesterday = appLocalISODate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    if (sort.key !== "date") return [[`Sorted by ${SORT_LABELS[sort.key].toLowerCase()}`, visible] as [string, TransactionDto[]]];
    const map = new Map<string, TransactionDto[]>();
    for (const t of visible) {
      const g = dayGroup(t, today, yesterday);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(t);
    }
    return Array.from(map.entries());
  }, [visible, sort.key]);

  return (
    <main className="flex-1 flex flex-col gap-5 px-4 pb-12 pt-6 lg:px-10 lg:pt-8 lg:pb-12 relative">
      {/* Desktop header */}
      <div className="hidden lg:flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display font-semibold text-[32px] tracking-tight">Transactions</h1>
          <span className="text-sm text-muted">
            {loading ? "Loading…" : <span>{visible.length} transactions</span>}
            {!loading && filtersActive && <span> · filtered from {items.length} · net {formatVND(visibleTotal)}</span>}
          </span>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => downloadCsv(visible)}
            disabled={visible.length === 0}
            className="flex items-center gap-2 bg-surface border border-border-input rounded-[10px] px-3.5 min-h-11 text-sm font-medium cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] disabled:opacity-50"
          >
            <Download size={16} />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 text-sm font-semibold cursor-pointer transition-colors duration-150 hover:bg-accent-strong"
          >
            <Plus size={16} strokeWidth={2.2} />
            Add transaction
          </button>
        </div>
      </div>

      {/* Mobile header */}
      <div className="lg:hidden flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display font-semibold text-2xl tracking-tight">Transactions</h1>
          <button
            type="button"
            aria-label="Add transaction"
            onClick={() => setAdding(true)}
            className="w-11 h-11 rounded-xl border border-border-input bg-surface flex items-center justify-center text-ink cursor-pointer transition-colors duration-150 active:bg-[#F4F2EC]"
          >
            <Plus size={18} strokeWidth={2.2} />
          </button>
        </div>
        <SearchInput id="m-tx-search" query={query} onChange={setQuery} placeholder="Search" />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["all", "expense", "income"] as TypeFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={typeFilter === t}
              onClick={() => setTypeFilter(t)}
              className={`shrink-0 text-[13px] rounded-full px-3.5 min-h-9 cursor-pointer transition-colors duration-150 ${
                typeFilter === t ? "bg-ink text-white font-semibold" : "bg-surface border border-border-input active:bg-[#F4F2EC]"
              }`}
            >
              {t === "all" ? "All" : t === "expense" ? "Expenses" : "Income"}
            </button>
          ))}
          <select
            aria-label="Category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            className="shrink-0 text-[13px] bg-surface border border-border-input rounded-full px-3.5 min-h-9 cursor-pointer"
          >
            <option value="all">Category</option>
            {Object.entries(CATEGORY_LABELS).filter(([value]) => value !== "salary" || salaryModeEnabled).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-expanded={mobileFiltersOpen}
            onClick={() => setMobileFiltersOpen((open) => !open)}
            className="shrink-0 flex items-center gap-1.5 text-[13px] bg-surface border border-border-input rounded-full px-3.5 min-h-9 cursor-pointer"
          >
            <SlidersHorizontal size={14} />
            Sort &amp; filter
          </button>
        </div>
        {mobileFiltersOpen && (
          <div className="flex flex-col gap-3 bg-surface border border-border rounded-2xl p-3.5">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Sort by
              <select
                value={`${sort.key}:${sort.dir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(":") as [SortKey, Sort["dir"]];
                  setSort({ key, dir });
                }}
                className="text-sm text-ink bg-surface border border-border-input rounded-[10px] px-3 min-h-10"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).flatMap((key) => (["desc", "asc"] as const).map((dir) => (
                  <option key={`${key}:${dir}`} value={`${key}:${dir}`}>
                    {SORT_LABELS[key]} · {sortDirectionLabel(key, dir)}
                  </option>
                )))}
              </select>
            </label>
            <RangeFilters range={range} onChange={setRange} />
            {filtersActive && <ClearFiltersButton onClick={clearFilters} />}
          </div>
        )}
        {!loading && filtersActive && (
          <p className="m-0 text-xs text-muted">
            {visible.length} of {items.length} transactions · net {formatVND(visibleTotal)}
          </p>
        )}
      </div>

      {/* Desktop filters */}
      <div className="hidden lg:flex flex-wrap gap-2.5 items-center">
        <div className="flex-1 min-w-[280px]">
          <SearchInput id="tx-search" query={query} onChange={setQuery} placeholder="Search description…" />
        </div>
        <div role="group" aria-label="Type" className="flex bg-[#F1EFE8] rounded-[10px] p-[3px]">
          {(["all", "expense", "income"] as TypeFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={typeFilter === t}
              onClick={() => setTypeFilter(t)}
              className={`text-[13px] rounded-lg min-h-[38px] px-3.5 cursor-pointer transition-colors duration-150 ${
                typeFilter === t ? "bg-white font-semibold" : "bg-transparent hover:text-ink"
              }`}
            >
              {t === "all" ? "All" : t === "expense" ? "Expenses" : "Income"}
            </button>
          ))}
        </div>
        <div className="relative">
          <select
            aria-label="Category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            className="appearance-none flex items-center gap-2 bg-surface border border-border-input rounded-[10px] pl-3.5 pr-8 min-h-11 text-sm cursor-pointer"
          >
            <option value="all">All categories</option>
            {Object.entries(CATEGORY_LABELS).filter(([value]) => value !== "salary" || salaryModeEnabled).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>
      <div className="hidden lg:flex flex-wrap gap-2.5 items-end -mt-2">
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={calendarView} onClick={() => setCalendarView((value) => !value)}
            className="flex min-h-10 items-center gap-2 rounded-[10px] border border-border-input bg-surface px-3 text-sm font-medium hover:bg-[#F4F2EC]">
            {calendarView ? <List size={16} /> : <CalendarDays size={16} />}
            {calendarView ? "List view" : "Calendar view"}
          </button>
        </div>
        <RangeFilters range={range} onChange={setRange} />
        {filtersActive && <ClearFiltersButton onClick={clearFilters} />}
      </div>

      <div className="lg:hidden flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={calendarView} onClick={() => setCalendarView((value) => !value)}
          className="flex min-h-9 items-center gap-1.5 rounded-full border border-border-input bg-surface px-3 text-xs font-medium">
          {calendarView ? <List size={14} /> : <CalendarDays size={14} />}
          {calendarView ? "List" : "Calendar"}
        </button>
      </div>

      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}

      {!loading && items.length === TRANSACTIONS_PAGE_LIMIT && (
        <p className="m-0 text-sm text-muted">
          Showing only the most recent {TRANSACTIONS_PAGE_LIMIT} transactions — filters, totals and CSV export
          only cover these.
        </p>
      )}

      {!loading && visible.length === 0 && (
        <p className="m-0 text-sm text-muted">
          {items.length > 0 ? "No transactions match these filters." : "No transactions yet. Add one from the AI Chat."}
        </p>
      )}

      {calendarView && (
        <section className="bg-surface border border-border rounded-2xl p-3 lg:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="m-0 text-base font-semibold">Transactions calendar</h2>
            <label className="flex items-center gap-2 text-sm text-muted">
              <span className="sr-only">Calendar month</span>
              <input type="month" aria-label="Calendar month" value={calendarMonth}
                onChange={(event) => applyCalendarMonth(event.target.value)}
                className="min-h-10 rounded-[10px] border border-border-input bg-surface px-3 text-sm text-ink" />
            </label>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border-row bg-border-row">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="bg-[#F4F2EC] px-1 py-2 text-center text-[11px] font-semibold text-muted lg:text-xs">{day}</div>
            ))}
            {(() => {
              const [year, month] = calendarMonth.split("-").map(Number);
              const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
              const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
              const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
                const day = index - offset + 1;
                if (day < 1 || day > days) return <div key={`empty-${index}`} className="min-h-20 bg-white lg:min-h-28" />;
                const date = `${calendarMonth}-${String(day).padStart(2, "0")}`;
                const dayItems = visible.filter((transaction) => transaction.occurredDate === date);
                const total = dayItems.reduce((sum, transaction) => sum + signedAmount(transaction), 0);
                return (
                  <div key={date} className="min-h-20 overflow-hidden bg-white p-1.5 lg:min-h-28 lg:p-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold">{day}</span>
                      {dayItems.length > 0 && <span className="truncate font-mono text-[9px] text-muted lg:text-[10px]">{formatVND(total)}</span>}
                    </div>
                    <div className="mt-1 flex flex-col gap-1">
                      {dayItems.slice(0, 3).map((transaction) => (
                        <button type="button" key={transaction.id} title={`${transaction.description}: ${formatVND(signedAmount(transaction))}`}
                          onClick={() => setViewingTransaction(transaction)}
                          className={`w-full truncate rounded px-1 py-0.5 text-left text-[9px] lg:text-[11px] ${transaction.direction === "income" ? "bg-accent-soft-bg text-accent-strong" : "bg-[#F4F2EC] text-ink-2"}`}>
                          {transaction.description}
                        </button>
                      ))}
                      {dayItems.length > 3 && <button type="button" onClick={() => setViewingDay(date)}
                        className="text-left text-[9px] font-medium text-accent-strong hover:underline">+{dayItems.length - 3} more</button>}
                    </div>
                  </div>
                );
              });
              return cells;
            })()}
          </div>
        </section>
      )}

      {/* Desktop table */}
      {!calendarView && <div className="hidden lg:block bg-surface border border-border rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="text-muted text-xs uppercase tracking-wide">
              <SortableHeader column="date" sort={sort} onSort={setSort} className="px-5" />
              <SortableHeader column="description" sort={sort} onSort={setSort} />
              <SortableHeader column="category" sort={sort} onSort={setSort} />
              <SortableHeader column="type" sort={sort} onSort={setSort} />
              <SortableHeader column="amount" sort={sort} onSort={setSort} align="right" />
              <th className="py-3.5 px-5 border-b border-border-nav">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id} className="transition-colors duration-150 hover:bg-[#FAF9F5]">
                <td className="py-3 px-5 border-b border-border-row text-ink-3 whitespace-nowrap font-mono text-[13px]">
                  {displayDate(t)}
                </td>
                <td className="py-3 px-3 border-b border-border-row font-medium">{t.description}</td>
                <td className="py-3 px-3 border-b border-border-row">
                  <span className="inline-block px-2.5 py-0.5 rounded-full bg-[#F4F2EC] text-[13px] text-ink-2">
                    {CATEGORY_LABELS[t.category]}
                  </span>
                </td>
                <td className="py-3 px-3 border-b border-border-row text-[13px] text-ink-3 capitalize">{t.direction}</td>
                <td
                  className={`py-3 px-3 border-b border-border-row text-right font-mono font-medium whitespace-nowrap ${
                    t.direction === "income" ? "text-accent" : "text-ink"
                  }`}
                >
                  {formatVND(t.direction === "income" ? Number(t.amount) : -Number(t.amount))}
                </td>
                <td className="py-2 pr-5 pl-3 border-b border-border-row whitespace-nowrap text-right">
                  <button
                    type="button"
                    aria-label="View evidence"
                    onClick={() => setViewingEvidenceFor(t)}
                    className="w-9 h-9 rounded-lg text-ink-3 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
                  >
                    <Eye size={16} className="mx-auto" />
                  </button>
                  <button
                    type="button"
                    aria-label="Edit transaction"
                    onClick={() => setEditing(t)}
                    disabled={Boolean(pendingChange)}
                    className="w-9 h-9 rounded-lg text-ink-3 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
                  >
                    <Pencil size={16} className="mx-auto" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete transaction"
                    onClick={() => handleDelete(t)}
                    disabled={deletingIds.has(t.id) || Boolean(pendingChange)}
                    className="w-9 h-9 rounded-lg text-ink-3 cursor-pointer transition-colors duration-150 hover:bg-[#FBEAE8] hover:text-danger disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={16} className="mx-auto" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {/* Mobile grouped list */}
      {!calendarView && <div className="lg:hidden flex flex-col gap-1.5">
        {groups.map(([group, groupItems]) => {
          const total = groupItems.reduce((a, t) => a + (t.direction === "income" ? Number(t.amount) : -Number(t.amount)), 0);
          return (
            <div key={group} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-muted px-0.5 pt-3 pb-1">
                <span className="font-semibold uppercase tracking-wide">{group}</span>
                <span className="font-mono">{formatVND(total)}</span>
              </div>
              <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                {groupItems.map((t, i) => (
                  <div key={t.id} className={`flex items-stretch ${i > 0 ? "border-t border-border-row" : ""}`}>
                    <button
                      type="button"
                      onClick={() => setRevealedId(revealedId === t.id ? null : t.id)}
                      className="flex-1 flex items-center gap-2.5 px-3.5 py-2.5 bg-surface text-left cursor-pointer transition-colors duration-150 active:bg-[#FAF9F5]"
                    >
                      <div className="flex-1 flex flex-col">
                        <span className="font-medium text-sm">{t.description}</span>
                        <span className="text-xs text-muted">{CATEGORY_LABELS[t.category]}</span>
                      </div>
                      <span className={`font-mono text-[13px] ${t.direction === "income" ? "text-accent" : ""}`}>
                        {formatVND(t.direction === "income" ? Number(t.amount) : -Number(t.amount))}
                      </span>
                    </button>
                    {revealedId === t.id && (
                      <>
                        <button
                          type="button"
                          onClick={() => setViewingEvidenceFor(t)}
                          className="text-xs font-medium w-16 border-0 bg-border-input cursor-pointer transition-colors duration-150 active:bg-[#D8D5CC]"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(t)}
                          disabled={Boolean(pendingChange)}
                          className="text-xs font-medium w-16 border-0 bg-border-input cursor-pointer transition-colors duration-150 active:bg-[#D8D5CC]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(t)}
                          disabled={deletingIds.has(t.id) || Boolean(pendingChange)}
                          className="text-xs font-semibold w-[72px] border-0 bg-danger text-white cursor-pointer transition-colors duration-150 active:bg-[#8F1B13] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {deletingIds.has(t.id) ? "…" : "Delete"}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>}

      {lastDeleted && (
        <div
          role="status"
          className="fixed left-4 right-4 bottom-4 lg:static lg:self-center lg:left-auto lg:right-auto lg:bottom-auto flex items-center justify-between gap-4 bg-ink text-white rounded-xl pl-4 pr-1.5 py-1.5 text-sm shadow-[0_12px_28px_-12px_rgba(22,32,26,0.45)] z-20"
        >
          <span>Deleted &ldquo;{lastDeleted.tx.description}&rdquo;</span>
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoing || Boolean(pendingChange)}
            className="font-semibold bg-white text-ink rounded-lg px-3.5 min-h-9 cursor-pointer transition-colors duration-150 hover:bg-[#EDEBE4] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {undoing ? "…" : "Undo"}
          </button>
        </div>
      )}

      {viewingDay && (
        <CalendarDayModal date={viewingDay} transactions={visible.filter((item) => item.occurredDate === viewingDay)}
          onClose={() => setViewingDay(null)} onSelect={(transaction) => {
            setViewingDay(null);
            setViewingTransaction(transaction);
          }} />
      )}

      {viewingTransaction && (
        <TransactionDetailsModal transaction={viewingTransaction} onClose={() => setViewingTransaction(null)}
          onEdit={() => {
            setEditing(viewingTransaction);
            setViewingTransaction(null);
          }}
          onViewEvidence={() => {
            setViewingEvidenceFor(viewingTransaction);
            setViewingTransaction(null);
          }} />
      )}

      {editing && (
        <TransactionFormModal
          title="Edit transaction"
          submitLabel="Review changes"
          savingLabel="Preparing preview…"
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={handleEditSave}
        />
      )}
      {adding && (
        <TransactionFormModal
          title="Add transaction"
          submitLabel="Save transaction"
          savingLabel="Saving…"
          initial={{
            amount: "", direction: "expense", description: "", category: "food_drink",
            occurredDate: appLocalISODate(new Date()), occurredTime: appLocalTime(new Date()),
          }}
          maxDate={appLocalISODate(new Date())}
          onCancel={() => setAdding(false)}
          onSave={handleCreate}
        />
      )}

      {pendingChange && (
        <TransactionChangePreview
          pending={pendingChange}
          busy={changeRequestPending}
          error={error}
          onCancel={handleCancelChange}
          onConfirm={handleConfirmChange}
        />
      )}

      {viewingEvidenceFor && (
        <EvidenceModal transaction={viewingEvidenceFor} onClose={() => setViewingEvidenceFor(null)} />
      )}
    </main>
  );
}
