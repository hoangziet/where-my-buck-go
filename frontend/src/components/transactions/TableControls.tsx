"use client";

import { Search, ArrowUp, ArrowDown, ArrowUpDown, X } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { SORT_LABELS, nextSort, type RangeFilter, type Sort, type SortKey } from "./table";

export function SortableHeader({
  column,
  sort,
  onSort,
  align = "left",
  className = "px-3",
}: {
  column: SortKey;
  sort: Sort;
  onSort: (next: Sort) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`py-2 font-semibold border-b border-border-nav ${className} ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, column))}
        title={`Sort by ${SORT_LABELS[column].toLowerCase()}`}
        className={`inline-flex items-center gap-1.5 uppercase tracking-wide text-xs font-semibold bg-transparent border-0 rounded-md px-1.5 -mx-1.5 min-h-9 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink ${
          active ? "text-ink" : "text-muted"
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {SORT_LABELS[column]}
        <Icon size={13} className={active ? "text-accent" : "opacity-50"} />
      </button>
    </th>
  );
}

export const RANGE_INPUT = "text-sm text-ink bg-surface border border-border-input rounded-[10px] px-3 min-h-10 outline-none transition-colors duration-150 focus:border-accent";

export function RangeFilters({ range, onChange }: { range: RangeFilter; onChange: (next: RangeFilter) => void }) {
  const set = (patch: Partial<RangeFilter>) => onChange({ ...range, ...patch });
  const digits = (value: string) => value.replace(/[^0-9]/g, "").slice(0, 15);
  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5 sm:items-end">
      <fieldset className="m-0 p-0 border-0 flex flex-col gap-1 min-w-0">
        <legend className="text-xs text-muted mb-1">Date</legend>
        <div className="flex items-center gap-1.5">
          <input type="date" aria-label="From date" value={range.dateFrom} max={range.dateTo || undefined}
            onChange={(e) => set({ dateFrom: e.target.value })} className={`${RANGE_INPUT} flex-1 min-w-0 sm:flex-none`} />
          <span className="text-muted text-sm">–</span>
          <input type="date" aria-label="To date" value={range.dateTo} min={range.dateFrom || undefined}
            onChange={(e) => set({ dateTo: e.target.value })} className={`${RANGE_INPUT} flex-1 min-w-0 sm:flex-none`} />
        </div>
      </fieldset>
      <fieldset className="m-0 p-0 border-0 flex flex-col gap-1 min-w-0">
        <legend className="text-xs text-muted mb-1">Amount (₫)</legend>
        <div className="flex items-center gap-1.5">
          <input inputMode="numeric" aria-label="Minimum amount" placeholder="Min"
            value={range.minAmount ? formatNumber(Number(range.minAmount)) : ""}
            onChange={(e) => set({ minAmount: digits(e.target.value) })} className={`${RANGE_INPUT} flex-1 min-w-0 sm:flex-none sm:w-32 font-mono`} />
          <span className="text-muted text-sm">–</span>
          <input inputMode="numeric" aria-label="Maximum amount" placeholder="Max"
            value={range.maxAmount ? formatNumber(Number(range.maxAmount)) : ""}
            onChange={(e) => set({ maxAmount: digits(e.target.value) })} className={`${RANGE_INPUT} flex-1 min-w-0 sm:flex-none sm:w-32 font-mono`} />
        </div>
      </fieldset>
    </div>
  );
}

export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 self-start lg:self-end text-sm font-medium bg-transparent text-ink-3 border-0 rounded-[10px] px-3 min-h-10 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
    >
      <X size={15} />
      Clear filters
    </button>
  );
}

export function SearchInput({
  id,
  query,
  onChange,
  placeholder,
}: {
  id: string;
  query: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2.5 bg-surface border border-border-input rounded-[10px] px-3.5 min-h-11 transition-colors duration-150 has-[input:focus]:border-accent">
      <Search size={17} className="text-muted shrink-0" />
      <label htmlFor={id} className="sr-only">
        Search transactions
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm border-0 outline-none bg-transparent flex-1 min-w-0 text-ink"
      />
    </div>
  );
}
