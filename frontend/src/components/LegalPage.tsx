import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/Logo";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-bg text-ink">
      <header className="mx-auto flex max-w-[900px] items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
          <LogoMark size={32} />
          <span className="font-display text-lg font-bold">Where My Buck Go</span>
        </Link>
        <Link href="/" className="text-sm text-muted no-underline hover:text-ink">Home</Link>
      </header>
      <article className="mx-auto max-w-[900px] px-6 pb-20 pt-8">
        <h1 className="m-0 font-display text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-muted">Last updated November 18, 2026</p>
        <div className="mt-10 flex flex-col gap-7 text-[15px] leading-7 text-ink-2 [&_h2]:mb-2 [&_h2]:mt-0 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_p]:m-0 [&_ul]:my-0 [&_ul]:pl-6">
          {children}
        </div>
      </article>
    </main>
  );
}
