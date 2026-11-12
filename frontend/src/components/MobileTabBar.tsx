"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, MessageCircle, List } from "lucide-react";

export function MobileTabBar() {
  const pathname = usePathname();
  if (pathname?.startsWith("/chat")) return null;

  const dashboardActive = pathname === "/dashboard";
  const txActive = pathname === "/transactions";

  return (
    <nav
      aria-label="App"
      className="lg:hidden grid grid-cols-3 items-center px-3 pt-2 pb-5 bg-surface border-t border-border-nav fixed bottom-0 left-0 right-0 z-30"
    >
      <Link
        href="/dashboard"
        aria-current={dashboardActive ? "page" : undefined}
        className={`flex flex-col items-center gap-0.5 min-h-12 justify-center no-underline text-[11px] transition-colors duration-150 active:text-accent-strong ${
          dashboardActive ? "text-accent-strong font-semibold" : "text-ink-3 font-medium"
        }`}
      >
        <LayoutGrid size={22} strokeWidth={1.9} />
        Home
      </Link>
      <Link
        href="/chat"
        aria-label="AI Chat"
        className="justify-self-center w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center -mt-6 shadow-[0_8px_20px_-8px_rgba(31,107,68,0.6)] transition-all duration-150 active:scale-95 active:bg-accent-strong"
      >
        <MessageCircle size={24} strokeWidth={2} />
      </Link>
      <Link
        href="/transactions"
        aria-current={txActive ? "page" : undefined}
        className={`flex flex-col items-center gap-0.5 min-h-12 justify-center no-underline text-[11px] transition-colors duration-150 active:text-accent-strong ${
          txActive ? "text-accent-strong font-semibold" : "text-ink-3 font-medium"
        }`}
      >
        <List size={22} strokeWidth={1.9} />
        Transactions
      </Link>
    </nav>
  );
}
