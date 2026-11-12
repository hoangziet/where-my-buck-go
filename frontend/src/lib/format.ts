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
