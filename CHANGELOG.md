# Changelog

## 2026-11-12 — 2026-11-13

- Fixed stale README claims about image evidence and chat history (both had been implemented but docs still said otherwise).
- Session expiry now redirects to `/login?expired=1` with a clear message instead of leaving the user on a dead page showing a raw error.
- Network failures, oversized chat image uploads, and the dashboard balance label now show accurate, actionable messages instead of raw errors or overclaiming "all" transactions.
- Editing, deleting, or undoing a transaction from a stale list now refreshes and explains itself instead of repeating a confusing 409.
- Closed a full sweep of double-submit races: the chat Confirm button, Pin-to-Dashboard, transaction Delete, the Undo-delete toast, and ambiguous-candidate selection all now guard against a second click firing while the first request is still in flight.
- The chat "Discard" button now actually persists the decision server-side (`POST /api/proposals/<id>/discard`) instead of only hiding the draft locally while it sits open in the database forever.
- The Transactions page now discloses when it has hit the backend's 200-row fetch cap, since filters, totals, and CSV export were silently scoped to it with no indication.
- "Today" is now computed in the app's fixed Asia/Ho_Chi_Minh timezone everywhere on the frontend, fixing a window every day (VN midnight–7am) where same-day transactions were mis-grouped into "Earlier".
- Fixed a blob-URL memory leak in the Evidence modal (image URLs were never revoked on close).
- Every inline error message now carries `role="alert"` so screen readers announce failures.
- The Edit and Evidence modals on Transactions now close on Escape.
- Added standard security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Strict-Transport-Security` in production).
