"use client";

import { useState } from "react";
import type { Category, TransactionDto } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/api";
import { useEscapeKey } from "@/lib/use-escape-key";

export function EditModal({
  transaction,
  onCancel,
  onSave,
}: {
  transaction: TransactionDto;
  onCancel: () => void;
  onSave: (fields: {
    amount: string; direction: "income" | "expense"; description: string; category: Category;
    occurredDate: string; occurredTime: string;
  }) => Promise<void>;
}) {
  const [description, setDescription] = useState(transaction.description);
  const [amount, setAmount] = useState(transaction.amount);
  const [direction, setDirection] = useState<"income" | "expense">(transaction.direction);
  const [category, setCategory] = useState<Category>(transaction.category);
  const [occurredDate, setOccurredDate] = useState(transaction.occurredDate);
  const [occurredTime, setOccurredTime] = useState(transaction.occurredTime);
  const [saving, setSaving] = useState(false);
  useEscapeKey(onCancel);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ amount, direction, description, category, occurredDate, occurredTime });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 z-30 flex items-center justify-center px-4" onClick={onCancel}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-3.5 w-full max-w-[420px]"
      >
        <h2 className="m-0 text-base font-semibold">Edit transaction</h2>
        <label className="flex flex-col gap-1 text-sm">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Amount (VND)
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "income" | "expense")}
              className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Date
            <input
              type="date"
              value={occurredDate}
              onChange={(e) => setOccurredDate(e.target.value)}
              required
              className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Time
            <input
              type="time"
              value={occurredTime}
              onChange={(e) => setOccurredTime(e.target.value)}
              required
              className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onCancel}
            className="font-medium text-sm bg-transparent text-ink-3 border-0 rounded-[10px] px-3.5 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-accent-strong disabled:opacity-60"
          >
            {saving ? "Preparing preview…" : "Review changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
