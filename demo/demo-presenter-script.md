# Where My Buck Go: 10-Minute Presenter Demo Script

A turn-by-turn presenter guide for demonstrating **Where My Buck Go** to technical stakeholders, executives, and users.

---

## 1. Ground Rules for the Demo

> **"Never let the model guess financial data. Teach the system to propose drafts, let the human confirm, and show the exact SQL behind every single number."**

- **Live URL:** `https://d1498jatb9ljtb.cloudfront.net` (or `http://localhost:3100` locally).
- **Core Focus:** Safety (zero blind writes), Auditability (live SQL parameter inspection), Speed (<5ms citations), and Mobile Experience (iOS PWA).
- **Latency Management:** Gemini calls take 1.5–3 seconds. Maintain narrative momentum while the model processes.

---

## 2. Schedule Breakdown

| Timestamp | Phase | Primary Action | Core Narrative |
|---|---|---|---|
| **0:00 – 1:30** | The Problem | Open Landing & Dashboard | Why generic LLMs fail at personal bookkeeping: hallucinations, blind database writes, and lack of audit trails. |
| **1:30 – 3:30** | Smart Intake & Draft Proposal | Text spend & Receipt photo | Draft proposal architecture: nothing writes to the ledger until the owner reviews and confirms. |
| **3:30 – 5:30** | Governed Q&A & SQL Trace | Natural language query | Transparent execution: expanding `Steps & SQL` to view parameterized queries, lock acquisitions, and bound parameters. |
| **5:30 – 7:00** | Immutable Ledger & Instant Citations | Navigate to `/transactions` | Sub-5ms image citations via SHA-256 ETags and HTTP 304 caching. Monospace right-aligned VND values. |
| **7:00 – 8:30** | Conversational Edit & Undo | Natural language update | Deterministic disambiguation and non-destructive soft deletes with complete audit history. |
| **8:30 – 10:00** | Standalone iOS PWA & Architecture | Mobile Safari / PWA demo | Native app feel without App Store friction: safe-area insets, camera receipt upload, AWS CloudFront + EC2 architecture. |

---

## 3. Script & Talking Points

### Act 1: The Problem (0:00 – 1:30)
**Screen:** Open Dashboard (`/dashboard`).

> *"Hầu hết các giải pháp trợ lý tài chính AI hiện nay đều gặp phải một rủi ro lớn: chúng được trao quyền ghi thẳng vào cơ sở dữ liệu hoặc tự tính toán số liệu bằng khả năng suy luận của mô hình ngôn ngữ lớn. Kết quả là hiện tượng ảo giác (hallucination), sai lệch số tiền, hoặc vô tình ghi trùng lặp dữ liệu."*
>
> *"Where My Buck Go được xây dựng theo triết lý 'Auditable by Construction'. Mọi khoản thu chi đều phải thông qua quy trình Draft-Confirm hai bước, và mọi câu trả lời số liệu đều được trích xuất từ câu truy vấn SQL thực thi trực tiếp trên PostgreSQL."*

---

### Act 2: Smart Intake & Draft Confirmation (1:30 – 3:30)
**Screen:** Open AI Chat (`/chat`).

1. Type into chat: `sáng nay ăn bún bò 55k`.
2. While the model is processing:
   > *"Hệ thống nhận diện thời gian theo múi giờ IANA thực tế của thiết bị người dùng (ClientClock: Asia/Ho_Chi_Minh). Gemini 2.5 Flash phân loại ý định, trích xuất số tiền 55.000 VNĐ và gắn danh mục Ăn uống."*
3. Point to the rendered Draft Card:
   > *"Để ý thấy: dữ liệu chưa hề được ghi vào sổ cái. Người dùng có toàn quyền xem lại và bấm 'Xác nhận & Lưu'. Đây là nguyên tắc Zero Blind Writes."*
4. Attach a receipt photo (`docs/assets/sample-receipt.png`):
   > *"Khi người dùng tải ảnh hoá đơn tính tiền, Gemini Vision trích xuất các thông tin chi tiết: tên quán, ngày giờ, số tiền tổng cộng 96.600 VNĐ, đồng thời lưu trữ ảnh gốc làm bằng chứng (Evidence) trên S3/R2."*
5. Click **Confirm & Save**:
   > *"Khi xác nhận, PostgreSQL kích hoạt Advisory Transaction Lock và kiểm tra Idempotency Key, đảm bảo ngay cả khi người dùng bấm đúp hoặc mạng chập chờn, dữ liệu vẫn được ghi nhận duy nhất một lần."*

---

### Act 3: Governed Q&A & Live SQL Trace (3:30 – 5:30)
**Screen:** AI Chat (`/chat`).

1. Ask: `tháng này tôi đã chi bao nhiêu tiền cho giải trí`.
2. When the answer appears:
   > *"Hệ thống phản hồi: 'Trong tháng này, bạn đã chi tổng cộng 96.600 VNĐ cho mục giải trí.' Số tiền này được truy vấn chính xác từ bảng giao dịch, định dạng tiền tệ Việt Nam đồng rõ ràng."*
3. Click to expand **Steps & SQL (3 steps · 6 queries)**:
   > *"Khán giả hãy nhìn vào bảng Trace Panel. Mọi bước xử lý đều được công khai minh bạch: từ khóa giao dịch, câu lệnh SQL với tham số parameterized `%s`, và bảng giá trị tham số thực tế. Không có bất kỳ con số nào được AI 'bịa' ra."*
4. Click **Refresh Query** button:
   > *"Nếu vừa có thêm giao dịch mới, ta chỉ cần bấm Refresh Query để truy vấn lại ngay lập tức mà không cần gõ lại prompt."*

---

### Act 4: Immutable Ledger & Instant Citations (5:30 – 7:00)
**Screen:** Navigate to `/transactions`.

1. Show the transaction ledger:
   > *"Trang Sổ cái tài chính hiển thị toàn bộ giao dịch với định dạng Monospace căn lề phải chuẩn xác, phân biệt màu sắc thu nhập (xanh ngọc) và chi tiêu (đỏ rượu)."*
2. Point out the eye icon next to the billiard receipt:
   > *"Các giao dịch có đính kèm hoá đơn sẽ hiển thị icon bằng chứng. Hãy để ý tốc độ khi tôi bấm vào xem ảnh."*
3. Click the eye icon:
   > *"Hộp thoại ảnh hoá đơn mở ra tức thì dưới 5 mili-giây. Để làm được điều này, hệ thống áp dụng cơ chế Batch Evidence Pre-population kết hợp HTTP 304 Not Modified và ETag SHA-256, hoàn toàn loại bỏ việc đọc lại S3 lặp đi lặp lại."*

---

### Act 5: Standalone iOS PWA & Wrap-up (7:00 – 10:00)
**Screen:** Switch to mobile simulator or phone screen showing the standalone PWA.

1. Show standalone mode:
   > *"Trên iPhone, người dùng chỉ cần chọn 'Thêm vào Màn hình chính' trên Safari. Web lập tức biến thành một ứng dụng PWA độc lập: toàn màn hình không thanh URL, tương thích hoàn hảo với Dynamic Island và thanh gạt Home, hỗ trợ chụp ảnh trực tiếp từ camera."*
2. Conclude:
   > *"Where My Buck Go chứng minh rằng một trợ lý tài chính AI cá nhân hoàn toàn có thể vừa thông minh, vừa tuyệt đối an toàn và minh bạch. Ứng dụng hiện đang chạy thực tế trên hạ tầng AWS CloudFront, Docker, và PostgreSQL."*
