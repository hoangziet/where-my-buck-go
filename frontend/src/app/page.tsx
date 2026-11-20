import Link from "next/link";
import { ArrowRight, MessageCircle, Receipt, Database, Check, Bookmark, History, ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { LandingActions } from "@/components/landing/LandingActions";
import { ReportPreview } from "@/components/landing/ReportPreview";

const features = [
  {
    icon: MessageCircle,
    title: "Talk, don't type forms",
    body: "Write “coffee 35k, rent 6tr” the way you'd say it. The AI picks out amounts, dates and categories for you.",
  },
  {
    icon: Receipt,
    title: "Snap a receipt",
    body: "Attach a photo in the chat. The total, date, store and line items are read for you, ready to review.",
  },
  {
    icon: Database,
    title: "Ask anything, get real numbers",
    body: "Questions use account-scoped queries. Open the steps to inspect the SQL behind an answer.",
  },
  {
    icon: Check,
    title: "Nothing saved without you",
    body: "Every AI suggestion arrives as a preview card. Confirm, edit or discard — your ledger stays clean.",
  },
  {
    icon: Bookmark,
    title: "A dashboard you build by asking",
    body: "Pin the answers you return to often and see spending patterns on your dashboard.",
  },
  {
    icon: History,
    title: "Undo and export anytime",
    body: "Search, filter and fix records by hand, undo a delete in one tap, and export any result to CSV.",
  },
];

const steps = [
  { n: "01", title: "Tell the AI", body: "Send a message, a receipt photo, or both. Vietnamese and English both work." },
  { n: "02", title: "Review the preview", body: "See the amount, date and category it found. Change anything that's off." },
  { n: "03", title: "Confirm and ask", body: "Saved records feed your reports. Ask a question whenever you want the bigger picture." },
];

export default function LandingPage() {
  return (
    <div className="landing-page min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-30 border-b border-border-row bg-bg/95 backdrop-blur-md">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-2.5 no-underline text-ink">
            <LogoMark size={32} />
            <span className="font-display font-bold text-lg tracking-tight">Where My Buck Go</span>
          </a>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-7 gap-y-3 text-[15px]">
            <a href="#features" className="text-ink-3 no-underline transition-colors duration-150 hover:text-ink">Features</a>
            <a href="#how" className="text-ink-3 no-underline transition-colors duration-150 hover:text-ink">How it works</a>
            <a href="#reports" className="text-ink-3 no-underline transition-colors duration-150 hover:text-ink">Reports</a>
            <LandingActions placement="nav" />
          </nav>
        </div>
      </header>

      <section
        id="top"
        className="relative isolate max-w-[1200px] mx-auto px-5 sm:px-8 py-18 pb-24 grid items-center gap-12 lg:gap-16"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute -z-10 right-0 top-8 h-[480px] w-[58%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(143,211,170,0.2),transparent_68%)]" />
        <div className="flex flex-col items-start gap-7">
          <p className="m-0 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent-strong">
            <span className="h-px w-8 bg-accent" /> Money clarity starts here
          </p>
          <h1
            className="m-0 font-display font-semibold tracking-tight"
            style={{ fontSize: "clamp(42px, 5.4vw, 68px)", lineHeight: 1.02, letterSpacing: "-0.035em" }}
          >
            Know where it went. <span className="text-accent">Keep moving.</span>
          </h1>
          <p className="m-0 text-lg text-ink-3 max-w-[520px]">
            Log spending the way you talk. Review every draft before it is saved, then ask real questions about your money.
          </p>
          <div className="flex flex-wrap gap-3">
            <LandingActions placement="hero" />
            <a href="#how" className="inline-flex items-center gap-2 bg-surface text-ink no-underline px-6 py-4 rounded-xl font-medium text-base border border-border-input transition-colors duration-150 hover:bg-[#F4F2EC]">
              See how it works <ArrowRight size={17} />
            </a>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border-row pt-5 text-[13px] text-ink-3">
            <span>One conversation</span><span>Every draft reviewed</span><span>Queries you can inspect</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent-soft-border bg-accent-soft-bg px-3 py-2 text-xs font-medium text-accent-strong">
            <ShieldCheck size={15} strokeWidth={1.8} /> Private by design · Your confirmation always comes first
          </div>
        </div>

        <figure className="relative m-0">
          <div className="absolute -inset-5 rounded-[34px] bg-[#E6EFE8] blur-2xl" aria-hidden="true" />
          <video
            controls
            playsInline
            preload="metadata"
            poster="/demo-poster.jpg"
            aria-label="Product demo showing an expense note, draft review and reporting"
            className="relative w-full aspect-video rounded-[22px] border border-border bg-surface shadow-[0_30px_80px_-40px_rgba(22,32,26,0.32)]"
          >
            <source src="/demo.mp4" type="video/mp4" />
          </video>
        </figure>
      </section>

      <section id="features" className="scroll-mt-20 bg-surface border-y border-border-row">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24 flex flex-col gap-12">
          <div className="flex flex-col gap-3.5 max-w-[640px]">
            <span className="text-[13px] font-semibold tracking-wide uppercase text-accent">Designed for everyday money</span>
            <h2 className="m-0 font-display font-semibold text-[44px] leading-tight tracking-tight">
              From the first note to the full picture.
            </h2>
            <p className="m-0 text-lg text-ink-3">A simple flow for capturing expenses, keeping records accurate and understanding what they mean.</p>
          </div>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}
          >
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="min-h-[218px] rounded-[18px] border border-border-row bg-bg p-7 flex flex-col gap-3.5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-1 hover:border-accent-soft-border hover:shadow-[0_16px_32px_-24px_rgba(22,32,26,0.32)]">
                <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft-bg text-accent"><Icon size={23} strokeWidth={1.8} /></span>
                <h3 className="m-0 text-[19px] font-semibold">{title}</h3>
                <p className="m-0 text-ink-3 text-[15px]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 max-w-[1200px] mx-auto px-5 sm:px-8 py-24 flex flex-col gap-12">
        <div className="flex flex-col gap-3.5 max-w-[640px]">
          <span className="text-[13px] font-semibold tracking-wide uppercase text-accent">How it works</span>
          <h2 className="m-0 font-display font-semibold text-[44px] leading-tight tracking-tight">A good habit in three steps.</h2>
        </div>
        <div className="grid gap-8" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {steps.map((s) => (
            <div key={s.n} className="flex flex-col gap-3 pt-5 border-t-2 border-ink">
              <span className="font-mono text-sm text-muted">{s.n}</span>
              <h3 className="m-0 text-xl font-semibold">{s.title}</h3>
              <p className="m-0 text-ink-3">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="reports" className="scroll-mt-20 bg-ink text-[#F4F2EC]">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24 grid items-center gap-14" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))" }}>
          <div className="flex flex-col gap-4.5">
            <span className="text-[13px] font-semibold tracking-wide uppercase text-[#8FD3AA]">Reports you can inspect</span>
            <h2 className="m-0 font-display font-semibold text-[44px] leading-tight tracking-tight">
              A clearer answer, with the work behind it.
            </h2>
            <p className="m-0 text-lg text-[#C9CEC9]">
              Ask about your spending. The backend runs account-scoped, parameterized queries and shows the steps and SQL behind the answer.
            </p>
            <p className="m-0 border-l-2 border-[#8FD3AA] pl-4 text-sm leading-6 text-[#C9CEC9]">Your records stay yours. A report never changes a transaction.</p>
          </div>
          <ReportPreview />
        </div>
      </section>

      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 py-28 flex flex-col items-center gap-6 text-center">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-accent">Ready when you are</p>
        <h2
          className="m-0 font-display font-semibold tracking-tight max-w-[760px]"
          style={{ fontSize: 52, lineHeight: 1.05, letterSpacing: "-0.035em" }}
        >
          Make more sense of every expense.
        </h2>
        <p className="m-0 text-lg text-ink-3 max-w-[520px]">One message is enough to start. Every decision stays in your hands.</p>
        <LandingActions placement="footer" />
      </section>

      <footer className="border-t border-border-row bg-surface">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-8 flex flex-wrap justify-between gap-4 text-sm text-muted">
          <span>© 2026 Where My Buck Go</span>
          <div className="flex flex-wrap gap-6">
            <Link href="/privacy" className="text-muted no-underline transition-colors duration-150 hover:text-ink">Privacy</Link>
            <Link href="/terms" className="text-muted no-underline transition-colors duration-150 hover:text-ink">Terms</Link>
            <Link href="/contact" className="text-muted no-underline transition-colors duration-150 hover:text-ink">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
