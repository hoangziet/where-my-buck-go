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

  if (loading || !username) return null;

  return <AppShell>{children}</AppShell>;
}
