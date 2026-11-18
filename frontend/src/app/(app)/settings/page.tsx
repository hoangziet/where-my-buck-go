"use client";

import { useEffect, useState } from "react";
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
  const [telegram, setTelegram] = useState<api.TelegramConnectionDto | null>(null);
  const [botToken, setBotToken] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);

  useEffect(() => {
    api.getTelegramConnection().then(setTelegram).catch((err: unknown) => {
      setTelegramError(err instanceof ApiError ? err.message : "Could not load Telegram settings.");
    });
  }, []);

  async function handleTelegramConnect(e: React.FormEvent) {
    e.preventDefault();
    setTelegramBusy(true);
    setTelegramError(null);
    setPairingCode(null);
    try {
      const result = await api.connectTelegramBot(botToken.trim());
      setTelegram({ connected: true, botUsername: result.botUsername, paired: false });
      setPairingCode(result.pairingCode);
      setBotToken("");
    } catch (err) {
      setTelegramError(err instanceof ApiError ? err.message : "Could not connect this Telegram bot.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function handleTelegramDisconnect() {
    setTelegramBusy(true);
    setTelegramError(null);
    try {
      await api.disconnectTelegramBot();
      setTelegram({ connected: false, botUsername: null, paired: false });
      setPairingCode(null);
    } catch (err) {
      setTelegramError(err instanceof ApiError ? err.message : "Could not disconnect Telegram.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function handlePairingRefresh() {
    setTelegramBusy(true);
    setTelegramError(null);
    try {
      const result = await api.refreshTelegramPairingCode();
      setPairingCode(result.pairingCode);
    } catch (err) {
      setTelegramError(err instanceof ApiError ? err.message : "Could not create a pairing code.");
    } finally {
      setTelegramBusy(false);
    }
  }

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
    <main className="flex-1 flex flex-col gap-6 px-4 pb-12 pt-6 lg:px-10 lg:pt-8 lg:pb-12">
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
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
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

      <section className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-4 max-w-[520px]">
        <div>
          <h2 className="m-0 text-base font-semibold">Telegram connection</h2>
          <p className="mt-1 mb-0 text-sm text-muted">
            Connect a personal bot created with BotFather. The bot token is encrypted before it is stored.
          </p>
        </div>
        {telegram?.connected ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm">Bot: <span className="font-medium">@{telegram.botUsername}</span></p>
            <p className="m-0 text-sm text-muted">{telegram.paired ? "Personal Telegram chat connected." : "Waiting for the pairing command."}</p>
            {pairingCode && (
              <div className="rounded-xl border border-border p-4 flex flex-col gap-2">
                <p className="m-0 text-sm">Open <a className="text-accent underline" href={`https://t.me/${telegram.botUsername}`} target="_blank" rel="noreferrer">@{telegram.botUsername}</a> and send this command within 15 minutes:</p>
                <code className="font-mono text-sm select-all">/connect {pairingCode}</code>
                <p className="m-0 text-xs text-muted">Keep this one-time code private. It expires after 15 minutes.</p>
              </div>
            )}
            {!telegram.paired && <button type="button" disabled={telegramBusy} onClick={handlePairingRefresh}
              className="self-start border border-border-input bg-transparent rounded-[10px] px-4 min-h-10 text-sm font-medium cursor-pointer disabled:opacity-60">
              Generate a new pairing code
            </button>}
            <button type="button" disabled={telegramBusy} onClick={handleTelegramDisconnect}
              className="self-start border border-border-input bg-transparent rounded-[10px] px-4 min-h-10 text-sm font-medium cursor-pointer disabled:opacity-60">
              Disconnect bot
            </button>
          </div>
        ) : (
          <form onSubmit={handleTelegramConnect} className="flex flex-col gap-3">
            <label htmlFor="telegram-token" className="text-sm font-medium">Bot token</label>
            <input id="telegram-token" type="password" autoComplete="off" required value={botToken}
              onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABC…"
              className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none focus:border-accent" />
            <button type="submit" disabled={telegramBusy}
              className="self-start font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer disabled:opacity-60">
              {telegramBusy ? "Connecting…" : "Connect Telegram bot"}
            </button>
          </form>
        )}
        {telegramError && <p role="alert" className="m-0 text-sm text-danger">{telegramError}</p>}
      </section>
    </main>
  );
}
