import type { DashboardSummary } from "@/lib/api";

export type DashboardPeriod = "week" | "month";

export interface ChartBucket {
  key: string;
  label: string;
  description: string;
  income: number;
  expense: number;
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  return utcDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function chartBuckets(summary: DashboardSummary, period: DashboardPeriod): ChartBucket[] {
  const days = new Map(summary.days.map((day) => [day.date, day]));
  if (period === "week") {
    const buckets: ChartBucket[] = [];
    for (const cursor = utcDate(summary.start); cursor <= utcDate(summary.end); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const key = isoDate(cursor);
      const value = days.get(key);
      buckets.push({ key, label: cursor.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
        description: shortDate(key), income: Number(value?.income ?? 0), expense: Number(value?.expense ?? 0) });
    }
    return buckets;
  }

  const buckets: ChartBucket[] = [];
  for (const cursor = utcDate(summary.start); cursor <= utcDate(summary.end);) {
    const first = isoDate(cursor);
    const last = new Date(cursor);
    last.setUTCDate(last.getUTCDate() + 6 - ((last.getUTCDay() + 6) % 7));
    if (last > utcDate(summary.end)) last.setTime(utcDate(summary.end).getTime());
    const end = isoDate(last);
    let income = 0;
    let expense = 0;
    for (const day = new Date(cursor); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
      const value = days.get(isoDate(day));
      income += Number(value?.income ?? 0);
      expense += Number(value?.expense ?? 0);
    }
    buckets.push({ key: first, label: `Week ${buckets.length + 1}`, description: `${shortDate(first)}–${shortDate(end)}`, income, expense });
    cursor.setUTCDate(last.getUTCDate() + 1);
  }
  return buckets;
}
