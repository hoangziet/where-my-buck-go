import { ChevronDown, Database, LockKeyhole } from "lucide-react";

const months = [
  { label: "September", income: "18,500,000", expenses: "7,740,000" },
  { label: "October", income: "18,500,000", expenses: "8,270,000" },
  { label: "November", income: "18,500,000", expenses: "9,350,000" },
];

const sql = `SELECT date_trunc('month', occurred_date) AS month,
       direction,
       sum(amount) AS total
FROM transactions
WHERE owner_id = :owner_id
  AND deleted_at IS NULL
  AND occurred_date >= :start_date
  AND occurred_date <= :end_date
GROUP BY date_trunc('month', occurred_date), direction
ORDER BY date_trunc('month', occurred_date);`;

export function ReportPreview() {
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/15 bg-white text-ink shadow-[0_28px_70px_-35px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between gap-4 border-b border-border-row px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-accent-soft-bg text-accent">
            <Database size={18} strokeWidth={1.8} />
          </span>
          <div>
            <p className="m-0 text-sm font-semibold">Monthly cash flow</p>
            <p className="m-0 text-xs text-muted">September–November 2026 · VND</p>
          </div>
        </div>
        <span className="hidden items-center gap-1 rounded-full bg-accent-soft-bg px-2.5 py-1 text-xs font-medium text-accent-strong sm:inline-flex">
          <LockKeyhole size={12} /> Account scoped
        </span>
      </div>

      <div className="overflow-x-auto px-5 py-3 sm:px-6">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-row text-xs text-muted">
              <th scope="col" className="py-3 text-left font-medium">Month</th>
              <th scope="col" className="py-3 text-right font-medium">Income</th>
              <th scope="col" className="py-3 text-right font-medium">Expenses</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.label} className="border-b border-border-row last:border-b-0">
                <th scope="row" className="py-3.5 text-left font-medium">{month.label}</th>
                <td className="py-3.5 text-right font-mono text-[13px] text-accent-strong">{month.income}</td>
                <td className="py-3.5 text-right font-mono text-[13px]">{month.expenses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="group border-t border-border-row bg-[#FAF9F5]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-ink-2 marker:hidden transition-colors hover:bg-[#F4F2EC] sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Database size={15} className="text-accent" /> View query steps &amp; SQL</span>
          <ChevronDown size={17} className="text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border-row px-5 py-5 sm:px-6">
          <ol className="m-0 grid list-none gap-3 p-0 text-[13px] text-ink-2 sm:grid-cols-3">
            <li><span className="mr-2 font-mono text-accent">01</span> Scope records to your account</li>
            <li><span className="mr-2 font-mono text-accent">02</span> Sum income and expenses by month</li>
            <li><span className="mr-2 font-mono text-accent">03</span> Build the report from the totals</li>
          </ol>
          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Parameterized SQL</p>
          <pre className="m-0 overflow-x-auto rounded-xl bg-[#17211B] p-4 text-[11px] leading-relaxed text-[#DDF2E4]">
            <code>{sql}</code>
          </pre>
          <p className="mb-0 mt-3 text-xs leading-relaxed text-muted">
            The backend supplies <code>:owner_id</code>, <code>:start_date</code> and <code>:end_date</code> as parameters.
            This is the monthly aggregation used by the app; the table above demonstrates the result.
          </p>
        </div>
      </details>
    </div>
  );
}
