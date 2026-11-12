import Link from "next/link";
import { MessageCircle, Receipt, Database, Check, Bookmark, History } from "lucide-react";
import { LogoMark } from "@/components/Logo";

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
    body: "Questions become SQL queries on your own data. Open the steps to see exactly what ran.",
  },
  {
    icon: Check,
    title: "Nothing saved without you",
    body: "Every AI suggestion arrives as a preview card. Confirm, edit or discard — your ledger stays clean.",
  },
  {
    icon: Bookmark,
    title: "A dashboard you build by asking",
    body: "Pin any table or chart from the chat. Your dashboard is made of the questions you actually care about.",
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
    <div className="min-h-screen bg-bg text-ink">
      <header className="max-w-[1200px] mx-auto px-8 py-6 flex flex-wrap items-center justify-between gap-4">
        <a href="#top" className="flex items-center gap-2.5 no-underline text-ink">
          <LogoMark size={32} />
          <span className="font-display font-bold text-lg tracking-tight">Where My Buck Go</span>
        </a>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-7 text-[15px]">
          <a href="#features" className="text-ink-3 no-underline transition-colors duration-150 hover:text-ink">Features</a>
          <a href="#how" className="text-ink-3 no-underline transition-colors duration-150 hover:text-ink">How it works</a>
          <a href="#reports" className="text-ink-3 no-underline transition-colors duration-150 hover:text-ink">Reports</a>
          <Link href="/login" className="text-ink no-underline font-medium transition-colors duration-150 hover:text-accent-strong">Sign in</Link>
          <Link href="/chat" className="bg-ink text-white no-underline px-4.5 py-2.5 rounded-[10px] font-medium transition-colors duration-150 hover:bg-accent-strong">Get started</Link>
        </nav>
      </header>

      <section
        id="top"
        className="max-w-[1200px] mx-auto px-8 py-18 pb-24 grid items-center gap-16"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}
      >
        <div className="flex flex-col gap-7">
          <h1
            className="m-0 font-display font-semibold tracking-tight"
            style={{ fontSize: "clamp(42px, 5.4vw, 68px)", lineHeight: 1.02, letterSpacing: "-0.035em" }}
          >
            Just tell it where your money went.
          </h1>
          <p className="m-0 text-lg text-ink-3 max-w-[520px]">
            Type it like a text, snap a receipt, or ask a question. Where My Buck Go turns plain language into clean records and real
            reports — and checks with you before anything is saved.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/chat" className="bg-accent text-white no-underline px-6 py-4 rounded-xl font-semibold text-base transition-colors duration-150 hover:bg-accent-strong">
              Start tracking free
            </Link>
            <a href="#how" className="bg-surface text-ink no-underline px-6 py-4 rounded-xl font-medium text-base border border-border-input transition-colors duration-150 hover:bg-[#F4F2EC]">
              See how it works
            </a>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-[22px] p-6 flex flex-col gap-4 shadow-[0_1px_2px_rgba(22,32,26,0.04),0_24px_48px_-24px_rgba(22,32,26,0.14)]">
          <div className="flex items-center justify-between pb-3.5 border-b border-border-row">
            <span className="font-semibold text-sm">AI Chat</span>
            <span className="text-xs text-muted">Today, 08:12</span>
          </div>
          <div className="self-end max-w-[80%] bg-ink text-white px-4 py-3 rounded-[16px_16px_4px_16px] text-[15px]">
            pho 45k this morning, grab to work 32k
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="text-sm text-ink-3">Found 2 expenses. Review before I save them:</span>
            <div className="border border-border rounded-[14px] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-border-row">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-[15px]">Phở breakfast</span>
                  <span className="text-[13px] text-muted">Food &amp; Drink · Today 07:30</span>
                </div>
                <span className="font-mono font-medium text-[15px]">−45.000 ₫</span>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-[15px]">Grab ride to work</span>
                  <span className="text-[13px] text-muted">Transport · Today 08:05</span>
                </div>
                <span className="font-mono font-medium text-[15px]">−32.000 ₫</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="font-semibold text-sm bg-accent text-white border-0 rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-accent-strong">
                Confirm both
              </button>
              <button type="button" className="font-medium text-sm bg-surface text-ink border border-border-input rounded-[10px] px-4 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC]">
                Edit
              </button>
              <button type="button" className="font-medium text-sm bg-transparent text-ink-3 border-0 rounded-[10px] px-3 min-h-11 cursor-pointer transition-colors duration-150 hover:bg-[#F4F2EC] hover:text-ink">
                Discard
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="bg-surface border-y border-border-row">
        <div className="max-w-[1200px] mx-auto px-8 py-24 flex flex-col gap-12">
          <div className="flex flex-col gap-3.5 max-w-[640px]">
            <span className="text-[13px] font-semibold tracking-wide uppercase text-accent">Features</span>
            <h2 className="m-0 font-display font-semibold text-[44px] leading-tight tracking-tight">
              One conversation for all of your money.
            </h2>
            <p className="m-0 text-lg text-ink-3">No forms to fill in. Everything starts in the chat, and you can still edit any record by hand.</p>
          </div>
          <div
            className="grid gap-px bg-border-row border border-border-row rounded-[18px] overflow-hidden"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}
          >
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-surface p-8 flex flex-col gap-3.5 transition-colors duration-150 hover:bg-[#FAF9F5]">
                <Icon size={26} strokeWidth={1.8} className="text-accent" />
                <h3 className="m-0 text-[19px] font-semibold">{title}</h3>
                <p className="m-0 text-ink-3 text-[15px]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="max-w-[1200px] mx-auto px-8 py-24 flex flex-col gap-12">
        <div className="flex flex-col gap-3.5 max-w-[640px]">
          <span className="text-[13px] font-semibold tracking-wide uppercase text-accent">How it works</span>
          <h2 className="m-0 font-display font-semibold text-[44px] leading-tight tracking-tight">Say it. Check it. Done.</h2>
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

      <section id="reports" className="bg-ink text-[#F4F2EC]">
        <div className="max-w-[1200px] mx-auto px-8 py-24 grid items-center gap-14" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
          <div className="flex flex-col gap-4.5">
            <span className="text-[13px] font-semibold tracking-wide uppercase text-[#8FD3AA]">Reports in chat</span>
            <h2 className="m-0 font-display font-semibold text-[44px] leading-tight tracking-tight">
              Ask a question. Get a table you can trust.
            </h2>
            <p className="m-0 text-lg text-[#C9CEC9]">
              The AI writes the SQL, runs it on your records and shows its work. Pin the result, export it, or ask a follow-up.
            </p>
          </div>
          <div className="bg-white text-ink rounded-[18px] p-5.5 flex flex-col gap-3.5">
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[#F6F5F0] rounded-[10px] text-sm">
              <span className="flex items-center gap-2 font-medium">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="8" ry="3" />
                  <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
                </svg>
                Query steps
              </span>
              <span className="font-mono text-[13px] text-accent">4/4 ✓</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[13px]">
                <thead>
                  <tr className="text-ink-3">
                    <th className="text-left py-2 px-2 font-medium border-b border-border">Month</th>
                    <th className="text-right py-2 px-2 font-medium border-b border-border">Food</th>
                    <th className="text-right py-2 px-2 font-medium border-b border-border">Transport</th>
                    <th className="text-right py-2 px-2 font-medium border-b border-border">Bills</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-2 px-2 border-b border-border-row">09/2026</td>
                    <td className="py-2 px-2 text-right border-b border-border-row">4.210.000</td>
                    <td className="py-2 px-2 text-right border-b border-border-row">1.150.000</td>
                    <td className="py-2 px-2 text-right border-b border-border-row">2.380.000</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-2 border-b border-border-row">10/2026</td>
                    <td className="py-2 px-2 text-right border-b border-border-row">4.875.000</td>
                    <td className="py-2 px-2 text-right border-b border-border-row">980.000</td>
                    <td className="py-2 px-2 text-right border-b border-border-row">2.415.000</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-2">11/2026</td>
                    <td className="py-2 px-2 text-right">5.420.000</td>
                    <td className="py-2 px-2 text-right">1.640.000</td>
                    <td className="py-2 px-2 text-right">2.290.000</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <span className="text-[13px] text-muted text-center">Spending by month and category · VND · sample data</span>
          </div>
        </div>
      </section>

      <section className="max-w-[1200px] mx-auto px-8 py-28 flex flex-col items-center gap-6 text-center">
        <h2
          className="m-0 font-display font-semibold tracking-tight max-w-[760px]"
          style={{ fontSize: 52, lineHeight: 1.05, letterSpacing: "-0.035em" }}
        >
          Find out where your buck goes.
        </h2>
        <p className="m-0 text-lg text-ink-3 max-w-[520px]">Start with one message. Your first report is a question away.</p>
        <Link href="/chat" className="bg-accent text-white no-underline px-7 py-4 rounded-xl font-semibold text-[17px] transition-colors duration-150 hover:bg-accent-strong">
          Start tracking free
        </Link>
      </section>

      <footer className="border-t border-border-row">
        <div className="max-w-[1200px] mx-auto px-8 py-8 flex flex-wrap justify-between gap-4 text-sm text-muted">
          <span>© 2026 Where My Buck Go</span>
          <div className="flex flex-wrap gap-6">
            <a href="#top" className="text-muted no-underline transition-colors duration-150 hover:text-ink">Privacy</a>
            <a href="#top" className="text-muted no-underline transition-colors duration-150 hover:text-ink">Terms</a>
            <a href="#top" className="text-muted no-underline transition-colors duration-150 hover:text-ink">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
