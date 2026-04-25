# Đặc tả: Workshop Catalog & Quản trị Workshop

## Mô tả

Tính năng cho phép:
- **Sinh viên**: xem danh sách workshop, lọc theo ngày/phòng/diễn giả, xem chi tiết (bao gồm AI summary), thấy số chỗ còn lại real-time.
- **Ban tổ chức (ORGANIZER)**: tạo, sửa, đổi phòng, đổi giờ, huỷ workshop; quản lý phòng và diễn giả.

## Luồng chính

### A. Sinh viên xem danh sách

1. Student Web gọi `GET /workshops?day=2026-05-14&page=1`.
2. Backend kiểm tra cache Redis `cache:workshop:list:{day}:v{n}` (TTL 5 phút).
3. Cache miss → query PostgreSQL với JOIN `workshops` + `rooms` + `speakers`, `WHERE status='PUBLISHED'`.
4. Mỗi workshop ghép thêm `seatsLeft` từ Redis `seat:{workshopId}` (atomic counter).
5. Response cache + trả client.
6. Client subscribe SSE `GET /workshops/stream` để nhận update `seatsLeft` real-time mỗi 2 giây.

### B. Sinh viên xem chi tiết

1. `GET /workshops/{id}`.
2. Trả full info + `summary` (nếu `summary_status=READY`) + `summaryStatus`.
3. Nếu `summary_status=PENDING` → client polling `/workshops/{id}` 10s/lần cho đến khi `READY` hoặc `FAILED`.

### C. ORGANIZER tạo workshop

1. `POST /workshops` (role check: ORGANIZER).
2. Validate:
   - `start_at < end_at`.
   - Khoảng `[start_at, end_at]` không trùng với workshop khác cùng `room_id` (status `PUBLISHED|DRAFT`).
   - `capacity ≤ rooms.capacity` (không thể bố trí hơn sức chứa phòng).
3. INSERT `workshops` với status mặc định `DRAFT`.
4. SET Redis `seat:{id} = capacity`.
5. Trả 201.

### D. ORGANIZER publish workshop

1. `POST /workshops/{id}/publish`.
2. Đổi `status DRAFT → PUBLISHED`.
3. Invalidate cache catalog (`DEL cache:workshop:list:*`).
4. Publish event `workshop.published` (trigger thông báo nếu cần).

### E. ORGANIZER đổi phòng / đổi giờ / sửa thông tin

1. `PATCH /workshops/{id}` với optimistic lock (`If-Match: version=N`).
2. Backend so `version` ở DB; nếu khác → 409 `concurrent_modification`.
3. Update DB + tăng version.
4. Nếu thay đổi ảnh hưởng SV đã đăng ký (đổi giờ/phòng/huỷ) → publish event `workshop.updated` → notification worker gửi thông báo cho mọi SV đã đăng ký.
5. Invalidate cache.

### F. ORGANIZER huỷ workshop

1. `POST /workshops/{id}/cancel` (kèm lý do).
2. Đổi `status → CANCELLED`.
3. Tự động:
   - Mọi `registrations` `CONFIRMED|PENDING_PAYMENT` chuyển `CANCELLED`.
   - Refund cho registration đã `SUCCESS` payment (gọi `POST /payments/{id}/refund` qua Circuit Breaker).
   - Publish `workshop.cancelled` → notification.
4. SET `seat:{id} = 0` (không cho đăng ký mới).

## Kịch bản lỗi

| Tình huống | Phản ứng |
|---|---|
| Tạo workshop trùng giờ trùng phòng | 422 `room_time_conflict`, kèm `conflictingWorkshopId` |
| Capacity > Room capacity | 422 `capacity_exceeds_room` |
| Sửa workshop bị 2 organizer đồng thời | 1 thắng, 1 nhận 409 `concurrent_modification` (optimistic lock) |
| Huỷ workshop có nhiều SV đã thanh toán | Refund từng người; lỗi refund được retry, không chặn huỷ; thông báo SV |
| Redis seat counter bị mất | Job rebuild đếm từ DB: `seat = capacity - count(registrations CONFIRMED|PENDING_PAYMENT)` |
| Cache stale (Admin update nhưng cache chưa invalidate) | TTL 5 phút auto refresh; thêm `version` trong key để force invalidate |
| SSE connection rớt | Client tự reconnect với `Last-Event-Id` |
| Workshop hết hạn (`end_at < now`) | Tự động chuyển `ENDED` mỗi 5 phút bằng cron |

## Ràng buộc

- **Hiệu năng**:
  - `GET /workshops` p95 < 300 ms khi có 12K user đồng thời (Redis cache + index DB phù hợp).
  - SSE chịu 12K subscriber đồng thời.
- **Tính nhất quán**:
  - `seat:{id}` Redis luôn = `capacity - active_registrations`. Job reconcile chạy 1 phút/lần.
  - Optimistic lock chống concurrent edit.
- **Bảo mật**:
  - Endpoint admin chỉ ORGANIZER.
  - Audit log mọi thao tác CRUD.
- **UX**:
  - Trang catalog hiển thị badge "Còn N chỗ", "Hết chỗ", "Đã đăng ký".
  - Thay đổi giờ/phòng phải gửi notification trong < 5 phút.

## Tiêu chí chấp nhận

- [ ] AC-01: SV xem `GET /workshops` thấy đủ danh sách `PUBLISHED`, không thấy `DRAFT`/`CANCELLED`.
- [ ] AC-02: `seatsLeft` cập nhật real-time qua SSE; tab khác đăng ký, tab này thấy số giảm trong < 3 giây.
- [ ] AC-03: ORGANIZER tạo 2 workshop trùng giờ trùng phòng → cái thứ 2 bị 422.
- [ ] AC-04: ORGANIZER tạo workshop với capacity > room capacity → 422.
- [ ] AC-05: 2 ORGANIZER cùng PATCH 1 workshop → 1 thành công, 1 nhận 409.
- [ ] AC-06: ORGANIZER huỷ workshop → tất cả SV đã đăng ký nhận thông báo trong < 5 phút.
- [ ] AC-07: Workshop hết giờ → tự động `ENDED` (cron 5 phút).
- [ ] AC-08: Cache invalidate khi update; SV F5 thấy data mới ngay.
- [ ] AC-09: Job rebuild seat counter chạy thành công sau khi xoá Redis key (test: `DEL seat:*` → sau 1 phút phục hồi đúng).
