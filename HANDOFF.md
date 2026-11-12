# Where My Buck Go — Build Handoff

AI personal finance manager. Users log income/expenses by chatting, attaching receipt photos, and asking questions that the AI answers by generating SQL. **The approved design is in `design/`** — open any `*.dc.html` file in a browser-like reader or read it as HTML; it is the source of truth for layout, copy, colors and spacing.

## 1. Screens (see `design/`)

| File | Screen | Notes |
|---|---|---|
| `Main.dc.html` | Landing page | Marketing page, links into the app |
| `Dashboard.dc.html` | Dashboard (desktop) | KPI cards, income vs expenses chart, category bars, recent transactions, **pinned chat results** |
| `Chat.dc.html` | AI Chat (desktop) — the hub | 3 flows: text entry → preview card → confirm; receipt image → extraction card → confirm; question → query steps (SQL) → result table → Export CSV / Pin / Copy SQL |
| `Transactions.dc.html` | Transactions (desktop) | Search, type filter, category/date filters, edit, delete with Undo toast, Export CSV |
| `MobileChatReceipt.dc.html`, `MobileChatReport.dc.html`, `MobileDashboard.dc.html`, `MobileTransactions.dc.html` | Mobile (390px) | Bottom tab bar with central Chat button; chat screens hide the tab bar |

`*.dc.html` files are a design-tool format: markup inside `<x-dc>` is plain HTML with inline styles; `{{holes}}`, `<sc-for>`, `<sc-if>` and the `class Component extends DCLogic` script are template/demo logic — reimplement them as React components, don't port the runtime.

## 2. Design tokens

| Token | Value | Use |
|---|---|---|
| `bg` | `#FBFAF6` | App background (ivory) |
| `surface` | `#FFFFFF` | Cards, sidebar |
| `ink` | `#16201A` | Primary text, user chat bubbles, expense amounts |
| `ink-2` | `#33403A` / `#4A554D` | Secondary text |
| `muted` | `#5B665E` | Labels, captions (passes 4.5:1 on white) |
| `border` | `#E8E6DE` (cards), `#E3E1D8` (inputs), `#F1EFE9` (row dividers) | |
| `accent` | `#1F6B44` | Primary buttons, income amounts, result values |
| `accent-strong` | `#14502F` | Active nav text |
| `accent-soft` | `#EEF5F0` (bg), `#BFDCC9` (border) | Active nav, pinned state |
| `chart-light` | `#A9D3B8` | Expense bars |
| `danger` | `#B42318` | Destructive swipe action |

Fonts (Google Fonts): **Space Grotesk** 600 for headings/big numbers, **Inter** 400/500/600 for UI, **IBM Plex Mono** 400/500 for amounts, SQL and result tables. Radii: 10px buttons/inputs, 14–16px cards, 20–22px composer, 999px pills. Touch targets ≥ 44px.

Money format: VND, dot thousands separator, `₫` suffix — `−45.000 ₫`, `+4.500.000 ₫`. Income is green with `+`; expenses are ink with `−` (never rely on color alone). UI copy is English.

## 3. Suggested stack

- **Next.js (App Router) + TypeScript + Tailwind CSS** (map tokens above into `tailwind.config`).
- **PostgreSQL** (e.g. Supabase or Neon) + **Drizzle ORM**; auth via Supabase Auth or Auth.js.
- **Claude API** (`claude-sonnet-5-5`) with tool use and vision; stream responses to the chat UI.
- Charts: Recharts. CSV: generate server-side from the same query result.

## 4. Data model

```sql
create table accounts (id uuid pk, user_id uuid not null, name text, kind text); -- Cash, MoMo, bank…
create table categories (id uuid pk, user_id uuid, name text, type text check (type in ('expense','income')));
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null check (type in ('expense','income')),
  amount bigint not null check (amount > 0),          -- VND, integer
  category text not null,
  description text not null,
  merchant text,
  account_id uuid references accounts(id),
  occurred_at timestamptz not null,
  source text not null check (source in ('chat','receipt','manual')),
  receipt_url text,
  line_items jsonb,                                    -- [{name, amount}]
  deleted_at timestamptz,                              -- soft delete → Undo
  created_at timestamptz default now()
);
create table pending_actions (                        -- AI proposals awaiting confirmation
  id uuid primary key, user_id uuid, chat_message_id uuid,
  kind text check (kind in ('create','update','delete')),
  payload jsonb not null, status text default 'pending', created_at timestamptz default now()
);
create table chats (id uuid pk, user_id uuid, title text, created_at timestamptz);
create table chat_messages (id uuid pk, chat_id uuid, role text, content jsonb, created_at timestamptz);
create table pinned_queries (                          -- Dashboard cards pinned from chat
  id uuid pk, user_id uuid, title text, sql text not null,
  viz jsonb,                                           -- {type:'table'|'bar'|'line', x, y, ...}
  source_message_id uuid, position int, created_at timestamptz
);
```

## 5. AI chat — tools

The chat endpoint sends the conversation (text + images as image content blocks) to Claude with these tools:

1. **`propose_transactions({ items: [{type, amount, category, description, merchant?, occurred_at, account?, line_items?}] })`**
   Used for typed entries and receipts. **Never writes to `transactions`.** Inserts into `pending_actions` and renders the preview card. Only the user's **Confirm** button commits (server action), then shows "Saved · Undo".
2. **`run_sql({ sql, purpose })`** — read-only analytics. Result renders as the "Query steps" block + result table + Export CSV / Pin to Dashboard / Copy SQL.
3. **`propose_edit` / `propose_delete`** — same confirm flow as #1 for changes requested in chat.

Receipt scanning needs no separate OCR service: pass the photo as an image block in the prompt and let the model call `propose_transactions` with `merchant`, `occurred_at`, total and `line_items`.

Give the model the schema of `transactions` (columns + allowed categories), today's date, timezone `Asia/Ho_Chi_Minh` and the VND convention in the system prompt.

## 6. SQL safety (must-have)

- Execute `run_sql` with a **dedicated read-only DB role**; reject anything that isn't a single `SELECT`/`WITH` statement (parse it, don't regex it).
- Scope rows to the user with **Row-Level Security** (`user_id = auth.uid()` and `deleted_at is null`) or a per-request view — never trust the model to add `WHERE user_id`.
- `statement_timeout` (e.g. 3s) and an enforced `LIMIT` (e.g. 1000 rows).
- Log every generated query with the message id; show it to the user in "Query steps".
- Pinned queries re-run through the same path when the Dashboard loads.

## 7. Behaviors to match the design

- Nothing AI-generated is saved without an explicit Confirm; every save/delete offers **Undo** (soft delete / revert pending action).
- "Query steps 4/4 ✓" is collapsible: understood request → generated SQL → ran (rows · ms) → formatted.
- Pin to Dashboard toggles to "Pinned to Dashboard" (accent-soft style).
- Transactions: search, All/Expenses/Income segmented filter, category + date range, Export CSV, delete toast with Undo.
- Responsive: sidebar layout ≥ 1024px; bottom tab bar with central Chat button below that.

## 8. Build order

1. Scaffold Next.js + Tailwind tokens + fonts; static layout shell (sidebar / mobile tab bar).
2. DB schema, auth, seed data matching the design (see sample transactions in `design/Transactions.dc.html`).
3. Transactions page (CRUD, filters, Undo, CSV).
4. AI Chat: streaming, `propose_transactions` + confirm flow, then image upload → receipt flow.
5. `run_sql` with the read-only role + RLS, result table, CSV, Copy SQL.
6. Pinned queries + Dashboard (KPIs, charts, pinned cards).
7. Landing page. Then mobile polish and tests (especially SQL guardrails).
