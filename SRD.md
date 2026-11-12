Rebuild Where My Buck Go: AI-powered personal finance assistant (Telegram + web), từ đầu, sạch —
dùng repo cũ chỉ để tham khảo ý tưởng tính năng, KHÔNG migrate code hay data SQLite cũ.

## Sản phẩm
- Trợ lý tài chính cá nhân qua web trước, Telegram ở milestone riêng sau bản web. Web UI có VI/EN; trích xuất giao dịch
  ưu tiên tiếng Việt, bảo toàn.
- Dùng cho 1 owner trước, nhưng thiết kế ranh giới user/bot để mở rộng nhiều user/bot sau.
- Giữ và cải thiện: chat nhiều lượt trên web (text kèm ảnh) cho nhập liệu, hỏi báo cáo,
  tìm kiếm và yêu cầu CRUD; thu/chi, chụp hoá đơn, lịch sử, báo cáo, export CSV từ báo cáo
  đã lọc, sửa, xoá, undo, dashboard web. Không import CSV.
- KHÔNG làm trong v1: đồng bộ ngân hàng, nhiều wallet, giao dịch lặp định kỳ, budget.

## Stack đã chốt
- Backend: Python + Flask, business logic tách khỏi route/SQL (domain/ riêng).
- Web: React + TypeScript + Vite, build tĩnh, serve cùng origin với API (1 image Docker).
- DB: PostgreSQL, Alembic migration có version, money là Decimal + currency code
  (không dùng float), ràng buộc unique cho idempotency.
- AI: Gemini API (`GEMINI_API_KEY`; structured output/function calling có schema và validate
  tất định phía backend) cho chat Q&A, phân loại intent, và trích xuất hoá đơn ảnh.
  KHÔNG dùng Anthropic hay Azure AI Foundry.
- Hàng đợi: không dùng Service Bus — 1 worker process poll outbox table trực tiếp mỗi vài
  giây, idempotent theo unique constraint.
- Evidence storage (ảnh hoá đơn, text gốc): Cloudflare R2 (production), filesystem
  adapter cho local dev. Production bắt buộc R2, không cho phép filesystem.
- Deploy: Oracle Cloud "Always Free" VM, docker compose (Postgres + API + worker trong
  cùng VM), image build & deploy qua GitHub Actions (workflow_dispatch, build → push GHCR
  → SSH deploy → alembic upgrade head → health check). Không dùng Azure resource nào.

## Ranh giới kiến trúc bắt buộc
- backend/src/where_my_buck_go/api/: route, validate request, session auth — KHÔNG chứa business/SQL logic.
- backend/src/where_my_buck_go/domain/: rule nghiệp vụ (money, transaction time, text/image validation,
  confirm, undo, report) độc lập Flask/SDK ngoài.
- backend/src/where_my_buck_go/services/: use case, orchestration, chat coordinator.
- backend/src/where_my_buck_go/adapters/: Postgres repo, Telegram, Gemini, R2 — implementation cụ thể.
- Chat coordinator điều hướng 2 specialist: Q&A (chỉ đọc, nhận dữ liệu đã lọc theo owner +
  lịch sử hội thoại bounded) và transaction intake (LLM trích xuất ngữ nghĩa tiếng Việt,
  domain kiểm tra tất định và tạo DRAFT). Yêu cầu tra cứu linh hoạt được chuẩn hoá thành
  truy vấn có cấu trúc; model không viết/chạy SQL trực tiếp.
  KHÔNG specialist nào được confirm/viết transaction trực tiếp — chỉ route confirm có
  version-check mới được viết. Input mơ hồ → mặc định về Q&A.

## Quy tắc nghiệp vụ bắt buộc (không thương lượng)
- Mọi tạo/sửa/xoá transaction cần preview + xác nhận rõ ràng (confirm riêng, không tự suy
  ra từ preview). Idempotency-Key UUID + expectedVersion cho mọi write; replay trả lại kết
  quả cũ, key trùng nhưng payload khác → 409.
- V1 chỉ chấp nhận VND (vẫn lưu currency code), timezone mặc định Asia/Ho_Chi_Minh. Tiền là Decimal chính xác,
  không round ngầm.
- Giao dịch từ text hoặc ảnh cần có ngày và giờ chính xác trước khi confirm. Nếu thiếu
  ngày thì hỏi lại, không suy ngày từ thời điểm gửi/upload/worker chạy. "Hôm nay/hôm qua"
  được giải nghĩa theo Asia/Ho_Chi_Minh tại lúc nhận yêu cầu. Nếu thiếu giờ, dùng mặc định
  theo buổi: sáng 07:00, trưa 11:00, chiều 15:00, tối 20:00; không rõ buổi thì 07:00.
  Preview phải nêu rõ giờ mặc định và cho sửa. Nếu có giờ rõ ràng, giữ nguyên giờ và suy ra buổi.
  Khung buổi: sáng 05:00–10:59, trưa 11:00–13:59, chiều 14:00–17:59, tối 18:00–04:59.
- 1 message liệt kê nhiều khoản → nhiều proposal riêng, xác nhận độc lập, khoản thiếu
  thông tin vẫn ở draft.
- 1 ảnh hoá đơn → 1 transaction theo tổng hoá đơn (không tách từng dòng), giữ ảnh gốc làm
  evidence, xem được trong web UI.
- Caption text có thể đi kèm ảnh để bổ sung ngữ cảnh. Khi caption và hoá đơn mâu thuẫn,
  hỏi người dùng trước khi confirm. Nhiều ảnh cùng một hoá đơn có thể gộp nếu rõ ràng;
  nếu không rõ thì hỏi lại. Mỗi hoá đơn riêng tạo một proposal.
- Evidence (text gốc, ảnh) luôn gắn với transaction/draft để user xem lại được.
- Mọi input từ model/Telegram/ảnh là untrusted — validate trước khi hành động nghiệp
  vụ; không bao giờ cho model chạy SQL trực tiếp.
- Webhook/retry phải idempotent (không giả định delivery exactly-once).
- Không log secret hay nội dung tài chính thô.
- Sửa/xoá/undo qua chat đều cần preview và confirm riêng; khi có nhiều giao dịch phù hợp,
  yêu cầu chọn cụ thể. Xoá mềm; undo là thay đổi được xác nhận, không xoá lịch sử.

## Auth
- Username/password only, không SSO/Entra, không self-register công khai (chỉ owner
  bootstrap qua CLI 1 lần).
- Argon2id hash, session bearer token 256-bit random trong cookie HttpOnly+SameSite=Strict
  (__Host- prefix khi production), hết hạn 12h, revoke được server-side.
- CSRF token bắt buộc cho mọi POST/PUT/PATCH/DELETE có session.
- Rate-limit đăng nhập 10 lần/15 phút/địa chỉ (lưu HMAC digest, không lưu IP thô).
- user_id lấy từ session, không bao giờ tin user_id từ request body.

## Code quality
- Module nhỏ, gọn, tên rõ nghĩa; file ≤1000 dòng, dòng ≤120 ký tự, hàm ≤50 dòng nghĩa.
- Python type hints đầy đủ cho public API, TypeScript strict, không `any`/cast ngầm/catch
  nuốt lỗi/fake success.
- Test cho money, date/time, confirm, undo, retry, permission. Lint/type/test/build chạy
  trước khi báo xong.

Triển khai theo milestone: auth → domain money/time → draft/confirm → chat web → ảnh trong
chat → web UI/báo cáo/export CSV → deploy Oracle → Telegram. Xác nhận với owner trước khi
code từng milestone; Telegram không chặn bản web đầu tiên. Ưu tiên kiểm thử đầy đủ trên
local (PostgreSQL local, filesystem evidence adapter local) trước khi bắt đầu bất kỳ deploy
nào; chỉ triển khai Oracle sau khi owner xác nhận bản local đạt yêu cầu.
