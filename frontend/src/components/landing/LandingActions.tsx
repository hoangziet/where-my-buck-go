"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

interface Props {
  placement: "nav" | "hero" | "footer";
}

export function LandingActions({ placement }: Props) {
  const { username, loading } = useAuth();
  if (loading) return <span aria-hidden="true" className="h-10 w-28 animate-pulse rounded-lg bg-border-row" />;

  if (placement === "nav") {
    return username ? (
      <Link href="/dashboard" className="rounded-[10px] bg-ink px-4.5 py-2.5 font-medium text-white no-underline transition-colors hover:bg-accent-strong">
        Open dashboard
      </Link>
    ) : (
      <>
        <Link href="/login" className="font-medium text-ink no-underline transition-colors hover:text-accent-strong">Sign in</Link>
        <Link href="/chat" className="rounded-[10px] bg-ink px-4.5 py-2.5 font-medium text-white no-underline transition-colors hover:bg-accent-strong">Get started</Link>
      </>
    );
  }

  return (
    <Link href={username ? "/dashboard" : "/chat"}
      className={`rounded-xl bg-accent font-semibold text-white no-underline transition-colors hover:bg-accent-strong ${placement === "hero" ? "px-6 py-4 text-base" : "px-7 py-4 text-[17px]"}`}>
      {username ? "Open dashboard" : "Start tracking free"}
    </Link>
  );
}
