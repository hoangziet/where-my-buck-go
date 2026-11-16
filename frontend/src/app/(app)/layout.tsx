"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth-context";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { username, loading, sessionExpired } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !username) router.replace(sessionExpired ? "/login?expired=1" : "/login");
  }, [loading, username, sessionExpired, router]);

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-bg gap-3">
        <div className="w-9 h-9 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        <span className="text-xs text-muted font-medium tracking-wide">Đang tải dữ liệu...</span>
      </div>
    );
  }

  if (!username) return null;

  return <AppShell>{children}</AppShell>;
}
