"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const expired = searchParams.get("expired") === "1";
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px] flex flex-col gap-7">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={40} />
          <h1 className="m-0 font-display font-semibold text-xl">Where My Buck Go</h1>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="text-sm border border-border-input rounded-[10px] px-3.5 min-h-11 bg-transparent outline-none transition-colors duration-150 focus:border-accent"
            />
          </div>
          {!error && expired && (
            <p className="m-0 text-sm text-ink-3">Your session expired. Please sign in again.</p>
          )}
          {error && <p className="m-0 text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-accent-strong disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
