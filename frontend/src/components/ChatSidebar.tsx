"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MessageSquare,
  PanelLeftClose,
  Plus,
  Settings,
  LogOut,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
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
  const [menuOpenChatId, setMenuOpenChatId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [deletingChat, setDeletingChat] = useState<ChatSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenChatId(null);
      }
    }
    if (menuOpenChatId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpenChatId]);

  function startRename(chat: ChatSummary, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
    setMenuOpenChatId(null);
  }

  async function handleSaveRename(id: string) {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingChatId(null);
      return;
    }
    setSavingRename(true);
    try {
      await api.renameChat(id, trimmed);
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)));
      setEditingChatId(null);
    } catch {
      // Keep edit state on failure
    } finally {
      setSavingRename(false);
    }
  }

  function startDelete(chat: ChatSummary, e: React.MouseEvent) {
    e.stopPropagation();
    setDeletingChat(chat);
    setMenuOpenChatId(null);
  }

  async function handleConfirmDelete() {
    if (!deletingChat) return;
    const targetId = deletingChat.id;
    setIsDeleting(true);
    try {
      await api.deleteChat(targetId);
      setChats((prev) => prev.filter((c) => c.id !== targetId));
      if (activeChatId === targetId) {
        onNewChat?.();
      }
      setDeletingChat(null);
    } catch {
      // Failed to delete
    } finally {
      setIsDeleting(false);
    }
  }

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
                const isEditing = chat.id === editingChatId;
                const isMenuOpen = chat.id === menuOpenChatId;

                if (isEditing) {
                  return (
                    <div
                      key={chat.id}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface border border-accent"
                    >
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveRename(chat.id);
                          if (e.key === "Escape") setEditingChatId(null);
                        }}
                        autoFocus
                        disabled={savingRename}
                        className="flex-1 min-w-0 bg-transparent text-xs text-ink outline-hidden border-0 px-1 py-0.5"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(chat.id)}
                        disabled={savingRename}
                        aria-label="Save title"
                        className="w-6 h-6 flex items-center justify-center rounded text-accent hover:bg-accent-soft-bg transition-colors border-0 bg-transparent cursor-pointer"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingChatId(null)}
                        disabled={savingRename}
                        aria-label="Cancel rename"
                        className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-[#F4F2EC] transition-colors border-0 bg-transparent cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={chat.id}
                    className={`relative w-full group flex items-center rounded-lg text-xs transition-colors ${
                      isActive
                        ? "bg-accent-soft-bg text-accent-strong font-semibold"
                        : "bg-transparent text-ink-3 hover:bg-[#F4F2EC] hover:text-ink font-normal"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectChat?.(chat.id)}
                      className="flex-1 flex items-center gap-2.5 px-2.5 py-2 text-left truncate border-0 bg-transparent cursor-pointer text-inherit font-inherit min-w-0"
                    >
                      <MessageSquare
                        size={14}
                        className={`shrink-0 ${isActive ? "text-accent-strong" : "text-muted group-hover:text-ink"}`}
                      />
                      <span className="truncate flex-1">{chat.title}</span>
                    </button>

                    {/* Options button */}
                    <div className="relative pr-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenChatId(isMenuOpen ? null : chat.id);
                        }}
                        aria-label="Chat options"
                        className={`w-7 h-7 flex items-center justify-center rounded-md border-0 bg-transparent cursor-pointer transition-opacity ${
                          isMenuOpen
                            ? "opacity-100 text-ink bg-[#E8E6DE]"
                            : "opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-ink hover:bg-[#E8E6DE]"
                        }`}
                      >
                        <MoreHorizontal size={15} />
                      </button>

                      {/* Dropdown Menu */}
                      {isMenuOpen && (
                        <div
                          ref={menuRef}
                          className="absolute right-0 top-8 z-50 min-w-[140px] bg-surface rounded-xl shadow-lg border border-border py-1 text-xs animate-in fade-in zoom-in-95 duration-100"
                        >
                          <button
                            type="button"
                            onClick={(e) => startRename(chat, e)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-ink hover:bg-[#F4F2EC] text-left border-0 bg-transparent cursor-pointer transition-colors"
                          >
                            <Pencil size={13} className="text-muted" />
                            <span>Rename</span>
                          </button>
                          <div className="my-1 border-t border-border-row" />
                          <button
                            type="button"
                            onClick={(e) => startDelete(chat, e)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 text-left border-0 bg-transparent cursor-pointer transition-colors"
                          >
                            <Trash2 size={13} className="text-red-500" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
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

      {/* Delete Confirmation Modal */}
      {deletingChat && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl shadow-xl max-w-sm w-full p-5 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h3 className="m-0 text-base font-semibold text-ink">Delete chat?</h3>
              <p className="mt-1.5 mb-0 text-xs text-muted leading-relaxed">
                This will delete &ldquo;{deletingChat.title}&rdquo; and all messages in this conversation.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setDeletingChat(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 text-xs font-medium text-ink bg-transparent hover:bg-[#F4F2EC] rounded-lg border border-border-input transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-3.5 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg border-0 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
