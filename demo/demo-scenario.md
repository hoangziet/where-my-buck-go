# Where My Buck Go: Product Demo Scenario

This document details the end-to-end demonstration scenarios for **Where My Buck Go**, modeled after modern enterprise financial and analytics agents. Every scenario is reproducible on both local development environments and the live AWS production stack.

---

## 1. System Overview & Core Tenets

| Core Tenet | How Where My Buck Go Implements It |
|---|---|
| **Auditable by Construction** | Answers always display the exact parameterized SQL queries and bound parameters executed against PostgreSQL. The model never fabricates numbers. |
| **Zero Blind Writes** | Financial transactions can **never** be inserted directly by an AI model. The model only creates unconfirmed draft proposals; the owner must explicitly confirm. |
| **Strict Owner Scoping** | All database operations are filtered with parameterized `WHERE owner_id = %(owner_id)s`. Multi-tenant data leakage is structurally impossible. |
| **Sub-5ms Citation Loading** | Receipts and proofs are stored as content-addressed binaries with SHA-256 ETags and HTTP 304 revalidation, skipping cloud storage reads on repeated views. |
| **ClientClock Timezone Sync** | Date semantics ("today", "yesterday", "this month") are resolved using the browser's exact IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). |
| **Standalone iOS PWA** | Web app manifest, high-resolution icons, iOS safe-area handling, and dynamic viewport units provide a native mobile app experience without App Store overhead. |

---

## 2. Walkthrough Scenario (10 Key Steps)

| # | Action / Prompt | System Behavior & SQL Trace | Expected Output & Verification |
|---|---|---|---|
| **1** | **Text Spend Intake**<br/>`sáng nay ăn bún bò 55k` | 1. Classify intent: `TRANSACTION_INTAKE`<br/>2. Extract amount: `55,000`, direction: `EXPENSE`, category: `FOOD_AND_DINING`<br/>3. Compute occurred date/time using `Asia/Ho_Chi_Minh` client timezone. | **Draft Preview Card** rendered inline:<br/>• Amount: `55.000 ₫`<br/>• Category: `Ăn uống`<br/>• Time: `07:00`<br/>• Action buttons: `[Confirm & Save]` and `[Discard]`. Nothing is written to the ledger yet. |
| **2** | **Receipt Photo Intake**<br/>Attach `docs/assets/sample-receipt.png` (or take photo on iPhone) | 1. Direct upload & inspect with Gemini 2.5 Flash Vision OCR.<br/>2. Extract total amount, transaction time, and description.<br/>3. Upload evidence image to S3 / Cloudflare R2 bucket. | **Draft Preview Card from Image**:<br/>• Merchant: `AN BILLARDS`<br/>• Amount: `96.600 ₫`<br/>• Category: `ENTERTAINMENT`<br/>• Thumbnail preview of original receipt with review button. |
| **3** | **Explicit Confirmation**<br/>Click `[Confirm & Save]` | 1. Acquire PostgreSQL advisory transaction lock: `pg_advisory_xact_lock(hash(owner_id))`.<br/>2. Check idempotency key: `SELECT ... FROM idempotency WHERE key = %s`.<br/>3. Insert immutable transaction row with attached `evidence_id`. | Confirmation toast with saved badge. Transaction is now permanently recorded in the immutable ledger. |
| **4** | **Natural Language Analytics Q&A**<br/>`tháng này tôi đã chi bao nhiêu tiền cho giải trí` | 1. Classify intent: `FINANCIAL_QA`<br/>2. Query category aggregate: `SELECT sum(amount) FROM transactions WHERE owner_id = %s AND direction = 'EXPENSE' AND category = 'ENTERTAINMENT' AND occurred_date >= %s`<br/>3. Return grounded summary. | Text response:<br/>`Trong tháng này, bạn đã chi tổng cộng 96.600 VNĐ cho mục giải trí.`<br/>With Monospace right-aligned VND formatting. |
| **5** | **Transparent Trace & SQL Inspection**<br/>Click `Steps & SQL (3 steps · 6 queries)` | Expand the real-time debug trace panel. | Shows each execution step with duration badges:<br/>• `pg_advisory_xact_lock`<br/>• Idempotency check<br/>• Gemini classification step<br/>• Parameterized SQL query and interactive bound parameters table showing `owner_id`, `direction`, `category`, and date boundaries. |
| **6** | **Live Data Re-run**<br/>Click `[Refresh Query]` on the answer card | Re-executes the exact analytical query against the database with fresh timestamps without requiring the user to type a new prompt. | Updated answer displayed instantly, ensuring real-time consistency with any recent ledger updates. |
| **7** | **Immutable Ledger & Filtering**<br/>Navigate to `/transactions` | 1. `GET /api/transactions?category=ENTERTAINMENT`<br/>2. Batch pre-populates evidence metadata (`list_evidence_batch`) in a single round-trip. | Structured transaction table with:<br/>• Date & Monospace right-aligned VND values (`-96.600 ₫` in ink red, `+` in emerald green)<br/>• Category pills<br/>• Evidence eye icon indicating receipt attachment. |
| **8** | **Sub-5ms Citation Preview**<br/>Click eye icon on transaction row | 1. Client requests `GET /api/evidence/<id>`.<br/>2. Server returns `ETag: "sha256-..."` and `Cache-Control: private, max-age=604800, immutable`.<br/>3. Subsequent requests return HTTP 304 Not Modified in <2ms. | High-resolution modal pop-up rendering the original receipt image instantly with progressive skeleton loader. |
| **9** | **Conversational Edit / Soft-Delete**<br/>`đổi giao dịch ăn bún bò lúc nãy thành 60k` | 1. Classify intent: `TRANSACTION_EDIT`<br/>2. Match against recent user transactions in the same owner scope.<br/>3. If multiple matches exist, return disambiguation list.<br/>4. Propose new draft replacing previous entry upon confirmation. | Proposes update draft card with diff view (`55.000 ₫` → `60.000 ₫`). Original transaction remains auditable. |
| **10** | **Mobile PWA Standalone Experience**<br/>Open on iOS Safari → "Add to Home Screen" | Browser loads `manifest.webmanifest`, high-res `apple-touch-icon.png`, and initializes standalone display mode with `viewport-fit=cover`. | App launches fullscreen without Safari URL bar or navigation chrome. Inputs do not auto-zoom (16px font), and layout respects Dynamic Island and home bar insets. |

---

## 3. Contrast Tests (Proving Deterministic Safety)

| Test Angle | Input / Action | Result | Why It Matters |
|---|---|---|---|
| **Cross-Tenant Isolation** | Log in as User B and ask: `tôi đã chi bao nhiêu cho bún bò` | Zero records found (`0 VNĐ`). | PostgreSQL parameterized owner scoping strictly isolates each user's financial ledger. |
| **Blind Write Prevention** | Tell chat: `hãy tự động lưu vào sổ cái chi tiêu 500k tiền xăng không cần hỏi` | Creates a draft card with confirmation button; refuses to write directly. | The application strictly enforces human-in-the-loop confirmation for every ledger write. |
| **Network Interruption / Double Click** | Confirm a draft twice simultaneously | First succeeds; second returns idempotent cached result. | Handled via PostgreSQL advisory transaction locks and atomic idempotency keys. |
