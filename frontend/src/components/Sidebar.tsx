"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, MessageCircle, List, LogOut } from "lucide-react";
import { LogoMark } from "./Logo";
import { useAuth } from "@/lib/auth-context";
import * as api from "@/lib/api";
import type { ChatSummary } from "@/lib/api";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/chat", label: "AI Chat", icon: MessageCircle },
  { href: "/transactions", label: "Transactions", icon: List },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const activeChatId = useSearchParams().get("id");
  const { username, logout } = useAuth();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const onChatPage = pathname?.startsWith("/chat");

  useEffect(() => {
    if (!onChatPage) return;
    api.listChats().then((res) => setChats(res.items)).catch(() => setChats([]));
  }, [onChatPage, activeChatId]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <aside className="hidden lg:flex lg:flex-col shrink-0 w-[232px] box-border px-4 py-6 border-r border-border-nav bg-surface gap-7">
      <Link href="/" className="flex items-center gap-2.5 no-underline text-ink px-2 rounded-lg py-1 transition-opacity duration-150 hover:opacity-80">
        <LogoMark />
        <span className="font-display font-bold text-base">Where My Buck Go</span>
      </Link>

      <nav aria-label="App" className="flex flex-col gap-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 px-3 py-[11px] rounded-[10px] no-underline text-[15px] transition-colors duration-150 ${
                active
                  ? "bg-accent-soft-bg text-accent-strong font-semibold"
                  : "text-ink-3 font-medium hover:bg-[#F4F2EC] hover:text-ink"
              }`}
            >
              <Icon size={18} strokeWidth={1.9} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {onChatPage && chats.length > 0 && (
        <div className="flex flex-col gap-1.5 overflow-y-auto">
          <span className="text-xs font-semibold tracking-wide uppercase text-muted px-3">Recent chats</span>
          {chats.map((c) => (
            <Link
              key={c.id}
              href={`/chat?id=${c.id}`}
              className={`px-3 py-2 rounded-lg no-underline text-sm truncate transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink ${
                c.id === activeChatId ? "bg-[#F4F2EC] text-ink" : "text-ink-3"
              }`}
            >
              {c.title}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2.5 px-2 py-3 border-t border-border-nav">
        <span className="w-[34px] h-[34px] rounded-full bg-[#E3EDE6] text-accent-strong flex items-center justify-center font-semibold text-[13px]">
          {(username ?? "?").slice(0, 2).toUpperCase()}
        </span>
        <div className="flex-1 flex flex-col min-w-0">
          <span className="font-medium text-sm truncate">{username}</span>
          <span className="text-xs text-muted">Personal</span>
        </div>
        <button
          type="button"
          aria-label="Sign out"
          onClick={handleLogout}
          className="w-9 h-9 rounded-lg text-ink-3 border-0 bg-transparent cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink"
        >
          <LogOut size={16} className="mx-auto" />
        </button>
      </div>
    </aside>
  );
}
