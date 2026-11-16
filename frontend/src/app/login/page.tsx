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
  const urlError = searchParams.get("error");
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(urlError);
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
    <div className="min-h-dvh flex items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-[380px] flex flex-col gap-7">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={40} />
          <h1 className="m-0 font-display font-semibold text-xl">Where My Buck Go</h1>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-4">
          <a
            href="/api/auth/google"
            className="flex items-center justify-center gap-3 w-full min-h-11 px-4 rounded-[10px] border border-border-input bg-surface hover:bg-surface-elevated font-medium text-sm text-ink transition-colors duration-150 no-underline"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>Sign in with Google</span>
          </a>

          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs uppercase tracking-wider text-ink-3 font-medium">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
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
    </div>
  );
}
