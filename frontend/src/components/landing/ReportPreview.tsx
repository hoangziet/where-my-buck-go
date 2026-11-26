"use client";

import { useRef } from "react";
import { ArrowUpRight, Database, LockKeyhole, X } from "lucide-react";

const transactions = [
  { date: "18 Nov", time: "08:15", description: "Breakfast sandwich", amount: "22.000 ₫" },
  { date: "17 Nov", time: "12:20", description: "Noodle lunch", amount: "28.000 ₫" },
  { date: "16 Nov", time: "19:30", description: "Dinner with friends", amount: "145.000 ₫" },
  { date: "16 Nov", time: "12:10", description: "Lunch set", amount: "42.000 ₫" },
  { date: "16 Nov", time: "07:45", description: "Coffee & toast", amount: "55.000 ₫" },
];

const categorySql = `SELECT transactions.category,
       sum(transactions.amount) AS total
FROM transactions
WHERE transactions.owner_id = :owner_id
  AND transactions.deleted_at IS NULL
  AND transactions.direction = :direction
  AND transactions.occurred_date >= :start_date
  AND transactions.occurred_date <= :end_date
GROUP BY transactions.category;`;

const recentSql = `SELECT occurred_date, occurred_time, description,
       category, amount, direction
FROM transactions
WHERE owner_id = :owner_id
  AND deleted_at IS NULL
ORDER BY occurred_date DESC, occurred_time DESC
LIMIT :limit;`;

export function ReportPreview() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <div className="overflow-hidden rounded-[22px] border border-white/15 bg-white text-ink shadow-[0_28px_70px_-35px_rgba(0,0,0,0.5)]">
      <div className="border-b border-border-row px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-accent-soft-bg text-accent">
              <Database size={18} strokeWidth={1.8} />
            </span>
            <div>
              <p className="m-0 text-sm font-semibold">Food &amp; Drink · This week</p>
              <p className="m-0 text-xs text-muted">16–18 November 2026 · VND</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="inline-flex items-center rounded-full border border-border-row px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Product preview</span>
            <span className="hidden items-center gap-1 rounded-full bg-accent-soft-bg px-2.5 py-1 text-xs font-medium text-accent-strong sm:inline-flex">
              <LockKeyhole size={12} /> Account scoped
            </span>
          </div>
        </div>
        <p className="mb-0 mt-4 rounded-xl bg-[#F4F2EC] px-4 py-3 text-sm font-medium text-ink-2">
          “How much have I spent on food and drink this week?”
        </p>
        <p className="mb-0 mt-4 text-sm leading-6 text-ink-2">
          This week, you spent <strong className="text-accent-strong">292.000 ₫</strong> on Food &amp; Drink across five transactions.
        </p>
      </div>

      <div className="overflow-x-auto px-5 py-3 sm:px-6">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-row text-xs text-muted">
              <th scope="col" className="py-3 text-left font-medium">Date &amp; time</th>
              <th scope="col" className="py-3 text-left font-medium">Description</th>
              <th scope="col" className="py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={`${transaction.date}-${transaction.time}`} className="border-b border-border-row last:border-b-0">
                <td className="py-3 text-left text-xs text-muted">{transaction.date} · {transaction.time}</td>
                <th scope="row" className="py-3 text-left font-medium">{transaction.description}</th>
                <td className="py-3 text-right font-mono text-[13px]">{transaction.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="flex w-full cursor-pointer items-center justify-between gap-4 border-0 border-t border-border-row bg-[#FAF9F5] px-5 py-4 text-left text-sm font-medium text-ink-2 transition-colors hover:bg-[#F4F2EC] sm:px-6"
      >
        <span className="flex items-center gap-2"><Database size={15} className="text-accent" /> View query steps &amp; SQL</span>
        <ArrowUpRight size={17} className="text-muted" />
      </button>

      <dialog
        ref={dialogRef}
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            dialogRef.current.close();
          }
        }}
        aria-labelledby="report-query-title"
        className="report-query-dialog overflow-y-auto rounded-[22px] border border-border-row bg-white p-0 text-ink shadow-[0_32px_90px_rgba(0,0,0,0.25)]"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border-row bg-white px-5 py-5 sm:px-7">
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-accent">Behind the answer</p>
            <h3 id="report-query-title" className="mb-0 mt-1 font-display text-2xl font-semibold">Query steps &amp; SQL</h3>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close query details"
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-border-row bg-white text-ink-2 hover:bg-[#F4F2EC]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-6 sm:px-7">
          <ol className="m-0 grid list-none gap-3 p-0 text-sm text-ink-2 sm:grid-cols-2">
            <li><span className="mr-2 font-mono text-accent">01</span> Classify the spending question</li>
            <li><span className="mr-2 font-mono text-accent">02</span> Read account-scoped category totals</li>
            <li><span className="mr-2 font-mono text-accent">03</span> Load recent account transactions</li>
            <li><span className="mr-2 font-mono text-accent">04</span> Match this week and Food &amp; Drink</li>
          </ol>
          <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Category totals · SQL template</p>
          <pre className="m-0 overflow-x-auto rounded-xl bg-[#17211B] p-4 text-xs leading-relaxed text-[#DDF2E4]"><code>{categorySql}</code></pre>
          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Recent transactions · SQL template</p>
          <pre className="m-0 overflow-x-auto rounded-xl bg-[#17211B] p-4 text-xs leading-relaxed text-[#DDF2E4]"><code>{recentSql}</code></pre>
          <p className="mb-0 mt-5 text-xs leading-relaxed text-muted">
            The backend binds <code>:owner_id</code> to the signed-in account, <code>:direction</code> to expense,
            <code> :start_date</code> and <code>:end_date</code> to the reporting period, and <code>:limit</code> to 200.
            The week and category shown here come from the returned records.
          </p>
        </div>
      </dialog>
    </div>
  );
}
