import { appLocalISODate } from "@/lib/format";
import type { Category, TransactionDto } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/api";

export type TypeFilter = "all" | "expense" | "income";

export type CategoryFilter = "all" | Category;

export type SortKey = "date" | "description" | "category" | "type" | "amount";

export type Sort = { key: SortKey; dir: "asc" | "desc" };

export type RangeFilter = { dateFrom: string; dateTo: string; minAmount: string; maxAmount: string };

export const DEFAULT_SORT: Sort = { key: "date", dir: "desc" };

export const EMPTY_RANGE: RangeFilter = { dateFrom: "", dateTo: "", minAmount: "", maxAmount: "" };

export const SORT_LABELS: Record<SortKey, string> = {
  date: "Date", description: "Description", category: "Category", type: "Type", amount: "Amount",
};

export function signedAmount(t: TransactionDto): number {
  return t.direction === "income" ? Number(t.amount) : -Number(t.amount);
}

export function compareBy(key: SortKey, a: TransactionDto, b: TransactionDto): number {
  switch (key) {
    case "date":
      return `${a.occurredDate} ${a.occurredTime}`.localeCompare(`${b.occurredDate} ${b.occurredTime}`);
    case "description":
      return a.description.localeCompare(b.description, "vi", { sensitivity: "base" });
    case "category":
      return CATEGORY_LABELS[a.category].localeCompare(CATEGORY_LABELS[b.category]);
    case "type":
      return a.direction.localeCompare(b.direction);
    case "amount":
      return signedAmount(a) - signedAmount(b);
  }
}

export function sortTransactions(items: TransactionDto[], sort: Sort): TransactionDto[] {
  const direction = sort.dir === "asc" ? 1 : -1;
  // Ties fall back to newest first so equal values keep a stable, predictable order.
  return [...items].sort((a, b) => direction * compareBy(sort.key, a, b) || -compareBy("date", a, b));
}

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: key === "date" || key === "amount" ? "desc" : "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

export function matchesRange(t: TransactionDto, range: RangeFilter): boolean {
  if (range.dateFrom && t.occurredDate < range.dateFrom) return false;
  if (range.dateTo && t.occurredDate > range.dateTo) return false;
  const amount = Number(t.amount);
  if (range.minAmount && amount < Number(range.minAmount)) return false;
  if (range.maxAmount && amount > Number(range.maxAmount)) return false;
  return true;
}

export function sortDirectionLabel(key: SortKey, dir: Sort["dir"]): string {
  if (key === "date") return dir === "desc" ? "newest first" : "oldest first";
  if (key === "amount") return dir === "desc" ? "highest first" : "lowest first";
  return dir === "asc" ? "A → Z" : "Z → A";
}

export function displayDate(t: TransactionDto): string {
  const [, month, day] = t.occurredDate.split("-");
  return `${day}/${month} ${t.occurredTime}`;
}

export function dayGroup(t: TransactionDto, today: string, yesterday: string): string {
  if (t.occurredDate === today) return "Today";
  if (t.occurredDate === yesterday) return "Yesterday";
  return "Earlier";
}

// Defends against CSV/formula injection: spreadsheet apps execute a cell starting with
// =, +, -, or @ as a formula, and description is free text an attacker could control
// (chat message or receipt image text). Prefixing with a tab keeps it inert as text.
export function csvSafe(value: string): string {
  return /^[=+\-@]/.test(value) ? `\t${value}` : value;
}

export function toCsv(items: TransactionDto[]): string {
  const header = "date,time,direction,category,amount,currency,description";
  const rows = items.map((t) =>
    [t.occurredDate, t.occurredTime, t.direction, t.category, t.amount, t.currency,
      `"${csvSafe(t.description).replace(/"/g, '""')}"`].join(","),
  );
  return [header, ...rows].join("\n");
}

export function downloadCsv(items: TransactionDto[]) {
  const blob = new Blob([toCsv(items)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${appLocalISODate(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
