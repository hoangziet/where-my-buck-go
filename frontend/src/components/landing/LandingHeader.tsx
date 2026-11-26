"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { LandingActions } from "@/components/landing/LandingActions";

const links = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#reports", label: "Reports" },
];

export function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border-row bg-bg/95 backdrop-blur-md">
      <div className="relative mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-3 sm:px-8 sm:py-4">
        <a href="#top" onClick={closeMenu} className="flex items-center gap-2.5 text-ink no-underline">
          <LogoMark size={32} />
          <span className="font-display text-lg font-bold tracking-tight">Where My Buck Go</span>
        </a>

        <button
          ref={menuButtonRef}
          type="button"
          className="flex size-11 cursor-pointer items-center justify-center rounded-xl border border-border-input bg-surface text-ink md:hidden"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="landing-mobile-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <nav aria-label="Main" className="hidden items-center gap-x-7 text-[15px] md:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="text-ink-3 no-underline transition-colors duration-150 hover:text-ink">
              {link.label}
            </a>
          ))}
          <LandingActions placement="nav" />
        </nav>

        <nav
          id="landing-mobile-navigation"
          aria-label="Main mobile"
          className={`${menuOpen ? "flex" : "hidden"} absolute inset-x-0 top-full flex-col gap-1 border-b border-border-row bg-bg px-5 py-4 shadow-lg md:hidden`}
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={closeMenu}
              className="rounded-lg px-3 py-3 text-ink-2 no-underline hover:bg-surface"
            >
              {link.label}
            </a>
          ))}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-3 pt-2">
            <LandingActions placement="nav" onNavigate={closeMenu} />
          </div>
        </nav>
      </div>
    </header>
  );
}
