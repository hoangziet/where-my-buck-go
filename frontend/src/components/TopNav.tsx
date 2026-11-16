"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, List, LogOut, MessageCircle, Settings } from "lucide-react";
import { LogoMark } from "./Logo";
import { useAuth } from "@/lib/auth-context";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/chat", label: "AI Chat", icon: MessageCircle },
  { href: "/transactions", label: "Transactions", icon: List },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { username, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-border-nav bg-surface pt-[env(safe-area-inset-top)]">
      <div className="min-h-16 lg:h-[72px] px-4 lg:px-7 xl:px-10 flex items-center justify-between gap-3 lg:justify-start lg:gap-8">
        <Link href="/dashboard" className="flex min-w-0 shrink-0 items-center gap-2.5 no-underline text-ink rounded-lg transition-opacity duration-150 hover:opacity-80">
          <LogoMark />
          <span className="font-display font-bold text-sm sm:text-base whitespace-nowrap">Where My Buck Go</span>
        </Link>

        <nav aria-label="App" className="hidden h-full flex-1 items-center gap-1 lg:flex">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 items-center gap-2 rounded-[10px] px-3.5 no-underline text-sm transition-colors duration-150 ${
                  active
                    ? "bg-accent-soft-bg text-accent-strong font-semibold"
                    : "text-ink-3 font-medium hover:bg-[#F4F2EC] hover:text-ink"
                }`}
              >
                <Icon size={17} strokeWidth={1.9} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 lg:gap-2">
          <span className="hidden lg:flex w-8 h-8 rounded-full bg-[#E3EDE6] text-accent-strong items-center justify-center font-semibold text-xs">
            {(username ?? "?").slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden max-w-36 truncate text-sm font-medium lg:inline">{username}</span>
          <Link
            href="/settings"
            aria-label="Settings"
            aria-current={pathname === "/settings" ? "page" : undefined}
            className={`w-9 h-9 rounded-lg no-underline flex items-center justify-center transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink ${pathname === "/settings" ? "text-accent-strong bg-accent-soft-bg" : "text-ink-3"}`}
          >
            <Settings size={16} />
          </Link>
          <button
            type="button"
            aria-label="Sign out"
            onClick={handleLogout}
            className="w-9 h-9 rounded-lg text-ink-3 border-0 bg-transparent cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
          >
            <LogOut size={16} className="mx-auto" />
          </button>
        </div>
      </div>

      <nav aria-label="Mobile app" className="flex h-12 items-center gap-1 overflow-x-auto border-t border-border-nav/70 px-3 lg:hidden">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 no-underline text-xs transition-colors duration-150 ${
                active ? "bg-accent-soft-bg text-accent-strong font-semibold" : "text-ink-3 font-medium hover:bg-[#F4F2EC] hover:text-ink"
              }`}
            >
              <Icon size={15} strokeWidth={1.9} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
