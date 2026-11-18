"use client";

import { CornerDownRight } from "lucide-react";

// Shown only on an empty, new conversation to show what the assistant can do; picking one sends it.
const STARTER_QUESTIONS = [
  "How much did I spend this week?",
  "Which category cost me the most this month?",
  "Did I spend more this month than last month?",
  "Lunch 50k",
];

export function StarterQuestions({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <nav aria-label="Suggested questions" className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Try asking</span>
      <ul className="m-0 p-0 list-none grid gap-2 sm:grid-cols-2">
        {STARTER_QUESTIONS.map((question) => (
          <li key={question}>
            <button
              type="button"
              onClick={() => onAsk(question)}
              className="w-full h-full flex items-center gap-2.5 text-left text-sm text-ink-2 bg-surface border border-border rounded-xl px-3.5 min-h-11 py-2.5 cursor-pointer transition-colors duration-150 hover:border-accent-soft-border hover:bg-accent-soft-bg hover:text-ink"
            >
              <CornerDownRight size={15} className="shrink-0 text-accent" />
              <span>{question}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
