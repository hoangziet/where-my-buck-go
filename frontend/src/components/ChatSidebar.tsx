"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, PanelLeftClose, Plus, Settings, LogOut } from "lucide-react";
import { LogoMark } from "./Logo";
import { useAuth } from "@/lib/auth-context";
import * as api from "@/lib/api";
import type { ChatSummary } from "@/lib/api";

interface ChatSidebarProps {
  activeChatId?: string;
  onSelectChat?: (id: string) => void;
  onNewChat?: () => void;
  isOpen: boolean;
  onToggle: () => void;
  refreshTrigger?: number;
}

export function ChatSidebar({
  activeChatId,
  onSelectChat,
  onNewChat,
  isOpen,
  onToggle,
  refreshTrigger = 0,
}: ChatSidebarProps) {
  const { username, logout } = useAuth();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.listChats()
      .then((res) => {
        if (mounted) setChats(res.items);
      })
      .catch(() => {
        if (mounted) setChats([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeChatId, refreshTrigger]);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-xs lg:hidden"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-surface border-r border-border transition-all duration-200 ease-in-out lg:static lg:z-10 ${
          isOpen ? "w-[260px] translate-x-0" : "-translate-x-full lg:w-0 lg:translate-x-0 lg:border-r-0 lg:overflow-hidden"
        }`}
        aria-label="Chat history"
      >
        <div className="w-[260px] flex-1 flex flex-col h-full min-h-0">
          {/* Header */}
          <div className="h-14 px-3.5 flex items-center justify-between border-b border-border-row shrink-0">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 no-underline text-ink font-semibold text-sm hover:opacity-85 transition-opacity"
            >
              <LogoMark size={22} />
              <span className="font-display tracking-tight text-xs uppercase font-bold text-ink-2">Where My Buck Go</span>
            </Link>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse sidebar"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-3 hover:text-ink hover:bg-[#F4F2EC] transition-colors border-0 bg-transparent cursor-pointer"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          {/* New chat action */}
          <div className="p-3 shrink-0">
            <button
              type="button"
              onClick={onNewChat}
              className="w-full h-10 px-3 flex items-center gap-2.5 rounded-xl border border-border-input bg-surface text-ink text-sm font-medium hover:bg-[#F4F2EC] hover:border-border transition-colors shadow-xs cursor-pointer"
            >
              <Plus size={16} className="text-accent" />
              <span>New chat</span>
            </button>
          </div>

          {/* Chat history list */}
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Recent
            </div>

            {loading && chats.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted">Loading chats...</div>
            ) : chats.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted">No chat history yet</div>
            ) : (
              chats.map((chat) => {
                const isActive = chat.id === activeChatId;
                return (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => onSelectChat?.(chat.id)}
                    className={`w-full group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left transition-colors cursor-pointer border-0 ${
                      isActive
                        ? "bg-accent-soft-bg text-accent-strong font-semibold"
                        : "bg-transparent text-ink-3 hover:bg-[#F4F2EC] hover:text-ink font-normal"
                    }`}
                  >
                    <MessageSquare size={14} className={`shrink-0 ${isActive ? "text-accent-strong" : "text-muted group-hover:text-ink"}`} />
                    <span className="truncate flex-1">{chat.title}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* Profile footer */}
          <div className="p-2.5 border-t border-border-row flex items-center justify-between gap-2 shrink-0 bg-surface">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="w-7 h-7 rounded-full bg-[#E3EDE6] text-accent-strong flex items-center justify-center font-semibold text-xs shrink-0">
                {(username ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <span className="truncate text-xs font-medium text-ink">{username}</span>
            </div>
            <Link
              href="/settings"
              aria-label="Settings"
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-[#F4F2EC] transition-colors"
            >
              <Settings size={14} />
            </Link>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-[#F4F2EC] transition-colors border-0 bg-transparent cursor-pointer"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
