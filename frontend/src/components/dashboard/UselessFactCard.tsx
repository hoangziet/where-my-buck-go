"use client";

import { useEffect, useState } from "react";
import { Lightbulb, RotateCw } from "lucide-react";
import { fetchRandomFact, type UselessFact } from "@/lib/useless-facts";

type FactState = { status: "loading" } | { status: "ready"; fact: UselessFact } | { status: "error" };

export function UselessFactCard() {
  const [state, setState] = useState<FactState>({ status: "loading" });
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchRandomFact(controller.signal)
      .then((fact) => setState({ status: "ready", fact }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [request]);

  function another() {
    setState({ status: "loading" });
    setRequest((n) => n + 1);
  }

  return (
    <section
      aria-label="Useless fact"
      aria-busy={state.status === "loading"}
      className="bg-surface border border-border rounded-2xl px-4.5 py-4 flex items-start gap-3.5"
    >
      <span className="w-9 h-9 shrink-0 rounded-[10px] bg-accent-soft-bg text-accent-strong flex items-center justify-center">
        <Lightbulb size={18} strokeWidth={1.9} />
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Useless fact</span>
        {state.status === "loading" && (
          <span className="flex flex-col gap-2 py-1" aria-hidden="true">
            <span className="h-3 w-4/5 rounded-full bg-[#EFEDE6] animate-pulse" />
            <span className="h-3 w-1/2 rounded-full bg-[#EFEDE6] animate-pulse" />
          </span>
        )}
        {state.status === "ready" && (
          <>
            <p className="m-0 text-[15px] leading-relaxed text-ink">{state.fact.text}</p>
            {state.fact.source && (
              <span className="text-xs text-muted">
                Source:{" "}
                {state.fact.sourceUrl ? (
                  <a href={state.fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-ink-3 hover:text-accent-strong">
                    {state.fact.source}
                  </a>
                ) : state.fact.source}
              </span>
            )}
          </>
        )}
        {state.status === "error" && (
          <p className="m-0 text-sm text-muted">Couldn&apos;t load a fact right now.</p>
        )}
      </div>
      <button
        type="button"
        onClick={another}
        disabled={state.status === "loading"}
        aria-label="Show another fact"
        title="Another fact"
        className="w-9 h-9 shrink-0 rounded-lg text-ink-3 border-0 bg-transparent flex items-center justify-center cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink disabled:opacity-50 disabled:cursor-default"
      >
        <RotateCw size={16} className={state.status === "loading" ? "animate-spin" : ""} />
      </button>
    </section>
  );
}
