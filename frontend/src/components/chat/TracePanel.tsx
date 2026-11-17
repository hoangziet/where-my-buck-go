"use client";

import { Check, Database, Sparkles } from "lucide-react";
import { formatVND } from "@/lib/format";
import type { TraceEntry } from "@/lib/api";

function StepDataPreview({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  if (obj.totals && typeof obj.totals === "object") {
    const totals = obj.totals as { income?: string; expense?: string };
    const range = obj.range as { start?: string; end?: string } | undefined;
    const txCount = typeof obj.transactionCount === "number" ? obj.transactionCount : undefined;
    return (
      <div className="mt-2 p-2.5 rounded-lg bg-[#EAE8E1] border border-border flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted mr-1">Query Result</span>
        {range && (
          <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono text-muted">
            {range.start} → {range.end}
          </span>
        )}
        {totals.income !== undefined && (
          <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono font-medium text-[#1E7E34]">
            +{formatVND(Number(totals.income))}
          </span>
        )}
        {totals.expense !== undefined && (
          <span className="px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono font-medium text-ink">
            −{formatVND(Number(totals.expense))}
          </span>
        )}
        {txCount !== undefined && (
          <span className="text-[11px] text-muted">
            ({txCount} {txCount === 1 ? "transaction" : "transactions"} matched)
          </span>
        )}
      </div>
    );
  }

  if (obj.itemCount !== undefined) {
    return (
      <div className="mt-2 p-2 rounded-lg bg-[#EAE8E1] text-[11px] text-ink-2 font-mono flex items-center gap-2">
        <span className="font-semibold text-muted uppercase text-[10px]">Result:</span>
        <span>{String(obj.itemCount)} parsed item(s)</span>
      </div>
    );
  }

  if (obj.matchCount !== undefined) {
    return (
      <div className="mt-2 p-2 rounded-lg bg-[#EAE8E1] text-[11px] text-ink-2 font-mono flex items-center gap-2">
        <span className="font-semibold text-muted uppercase text-[10px]">Result:</span>
        <span>{String(obj.matchCount)} matching transaction(s) found</span>
      </div>
    );
  }

  return null;
}

function ParametersTable({ rawParams }: { rawParams: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawParams);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) return null;
    return (
      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-[11px] font-mono border-collapse">
          <thead>
            <tr className="bg-[#EFECE6] text-ink-2 border-b border-border">
              <th className="px-2.5 py-1.5 font-semibold text-muted text-[10px] uppercase tracking-wider">Parameter</th>
              <th className="px-2.5 py-1.5 font-semibold text-muted text-[10px] uppercase tracking-wider">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-row">
            {entries.map(([key, val]) => (
              <tr key={key} className="hover:bg-[#F9F8F5]">
                <td className="px-2.5 py-1.5 text-ink font-medium select-all">{key}</td>
                <td className="px-2.5 py-1.5 text-accent-strong select-all">{typeof val === "object" ? JSON.stringify(val) : String(val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="mt-1.5 px-3 py-2 rounded-lg bg-[#EFECE6] text-[11px] font-mono text-ink-2 break-all">
      <span className="font-semibold text-muted select-none">PARAMS: </span>
      <span>{rawParams}</span>
    </div>
  );
}

export function TracePanel({ entries }: { entries: TraceEntry[] }) {
  const sqlCount = entries.filter((entry) => entry.kind === "sql").length;
  return (
    <details className="group rounded-xl border border-border bg-[#F8F7F2] overflow-hidden">
      <summary className="flex items-center gap-2 px-3.5 py-3 text-[13px] font-medium text-ink-2 cursor-pointer select-none hover:bg-[#F1EFE8]">
        <Sparkles size={15} className="text-accent" />
        <span>Steps &amp; SQL</span>
        <span className="text-muted font-normal">{entries.length - sqlCount} steps · {sqlCount} queries</span>
      </summary>
      <div className="border-t border-border divide-y divide-border">
        {entries.map((entry, index) => (
          <div key={`${entry.kind}-${index}`} className="px-3.5 py-3">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
              {entry.kind === "sql" ? <Database size={14} className="text-accent" /> : <Check size={14} className="text-accent" />}
              <span>{entry.title}</span>
            </div>
            {entry.detail && <p className="mt-1 mb-0 text-xs text-muted">{entry.detail}</p>}
            {entry.data && <StepDataPreview data={entry.data} />}
            {entry.sql && (
              <div className="mt-2 flex flex-col gap-2">
                {entry.inlinedSql && (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Executed Query (With Parameters)</span>
                    <pre className="mt-1 mb-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#17211B] p-3 text-[11px] leading-relaxed text-[#E6F1E9]">
                      <code>{entry.inlinedSql}</code>
                    </pre>
                  </div>
                )}
                {(!entry.inlinedSql || entry.inlinedSql !== entry.sql) && (
                  <div>
                    {entry.inlinedSql && <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">SQL Template</span>}
                    <pre className="mt-1 mb-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[#17211B] p-3 text-[11px] leading-relaxed text-[#A2B8A6]">
                      <code>{entry.sql}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
            {entry.parameters && <ParametersTable rawParams={entry.parameters} />}
          </div>
        ))}
        <p className="m-0 px-3.5 py-2.5 text-[11px] text-muted">These are system actions, not the model&apos;s private reasoning. SQL queries and parameter tables are shown above.</p>
      </div>
    </details>
  );
}
