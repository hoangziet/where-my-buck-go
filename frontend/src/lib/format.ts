export function formatVND(amount: number): string {
  const sign = amount < 0 ? "−" : "+";
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${digits} ₫`;
}

export function formatVNDSigned(amount: number, type: "income" | "expense"): string {
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return type === "income" ? `+${digits} ₫` : `−${digits} ₫`;
}

export function formatNumber(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// The app's single canonical timezone (see SRD); transactions are dated in it regardless of the
// viewer's own clock, so "today" must be computed the same way or dates near midnight UTC mis-group.
const APP_TIMEZONE = "Asia/Ho_Chi_Minh";

export function appLocalISODate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(date);
}

export function appLocalMonthYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, month: "long", year: "numeric" }).format(date);
}

export function appLocalMonth(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, month: "long" }).format(date);
}
