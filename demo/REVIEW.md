# Review — Where My Buck Go 28s demo

Beats: hook "Say what you spent." → AI Chat: message, reply, Draft preview card, punch-in, cursor clicks Confirm → Saved (0–7.8s) → Telegram: log lunch, review and confirm the draft, then ask a weekly Food & Drink question and get an answer (7.8–21s) → dashboard: monthly totals and category breakdown update (21–25.2s) → end card (25.2–28.2s).

- UI rebuilt from `frontend/src` with the app's labels, colours and review-before-saving flow.
- Kokoro `af_heart` narrates the Telegram sequence; Whisper `small.en` generated the word-level transcript used for caption timing.
- Review scene seams and all Telegram dialogue/caption timings in the Studio preview before rendering.
