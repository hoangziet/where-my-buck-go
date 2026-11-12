"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const router = useRouter();
  const { username, invalidate } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      invalidate();
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 flex flex-col gap-6 px-4 pb-28 pt-6 lg:px-10 lg:pt-8 lg:pb-12">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display font-semibold text-[32px] tracking-tight">Settings</h1>
        <span className="text-sm text-muted">Signed in as {username}</span>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-4 max-w-[420px]"
      >
        <h2 className="m-0 text-base font-semibold">Change password</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current-password" className="text-sm font-medium">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="text-sm font-medium">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
          />
          <span className="text-xs text-muted">At least 12 characters.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-password" className="text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
          />
        </div>
        {error && <p className="m-0 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="self-start font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-accent-strong disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Change password"}
        </button>
        <p className="m-0 text-xs text-muted">
          Changing your password signs you out everywhere; you&apos;ll need to sign in again.
        </p>
      </form>
    </main>
  );
}
