# UniHub Workshop - Kịch Bản Quay Video Demo

File này là kịch bản quay video nộp bài cho yêu cầu trong
`ĐỒ ÁN MÔN HỌC – UniHub Workshop _ software-design-docs.html`.

Mục tiêu video:

- Demo trực tiếp trên code hoặc ứng dụng đang chạy, không làm slide thuần túy.
- Có camera thành viên thuyết trình.
- Video đặt trong thư mục `clips/`, định dạng MP4, FullHD 1080p, bitrate khoảng
  720 kbps.
- Bao phủ đủ các chức năng: xem/đăng ký workshop, notification, admin,
  check-in, AI Summary, CSV sync.
- Chứng minh các vấn đề kỹ thuật: tránh trùng ghế, tải đột biến 12K/10 phút,
  payment không ổn định, idempotency, offline check-in, CSV legacy một chiều.

## 0. Chuẩn Bị Trước Khi Quay

Chạy từ thư mục `src`:

```powershell
cd <repo>\src
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm install
pnpm stack:up
docker compose --profile all exec backend pnpm run seed
docker compose --profile all ps
```

Nếu demo AI Summary thật, đặt `GEMINI_API_KEY` trong `src/.env` trước khi
`pnpm stack:up` hoặc recreate backend:

```powershell
docker compose --profile all up -d --build backend
```

Mở sẵn các tab:

| Tab | URL / File |
| --- | --- |
| Student Web | http://localhost:5173 |
| Admin Web | http://localhost:5174 |
| Backend health | http://localhost:3000/health |
| Metrics | http://localhost:3000/metrics |
| Mailhog | http://localhost:8025 |
| RabbitMQ UI | http://localhost:15672 |
| MinIO Console | http://localhost:9001 |
| Blueprint | `blueprint/design.md` và `blueprint/specs/` |
| Test runbook | `src/docs/TESTING_DEMO_SCRIPTS.md` |

Tài khoản seed:

| Role | Email | Password |
| --- | --- | --- |
| SYS_ADMIN | `admin@unihub.local` | `Admin@123456` |
| ORGANIZER | `organizer@unihub.local` | `Test@12345` |
| CHECKIN_STAFF | `staff@unihub.local` | `Test@12345` |

Sinh viên dùng Student Web để register với MSSV mẫu:
`21120001..21120006`, `22120004..22120005`.

## 1. Mapping Yêu Cầu Đề Bài Vào Đoạn Quay

| Yêu cầu trong đề bài | Đoạn quay nên có |
| --- | --- |
| Xem lịch workshop, số chỗ real-time | Student Web catalog + SSE `/workshops/stream` |
| Đăng ký workshop, nhận QR | Student Web đăng ký workshop free/paid |
| Notification app/email | In-app notification + Mailhog |
| Admin tạo/sửa/hủy workshop | Admin Web CRUD/publish/cancel |
| Check-in bằng mobile, hỗ trợ offline | Expo mobile + SQLite queue + sync |
| AI Summary từ PDF | Admin upload PDF + Gemini summary READY |
| Đồng bộ CSV legacy | `smoke-csv-sync.ps1`, import jobs, quarantine/archive |
| Tranh chấp ghế | `pnpm demo:race -- --clients=100` |
| Tải đột biến 12K/10 phút | Show k6 script/output `k6-12k-summary.json` |
| Payment không ổn định | Mock PG + Circuit Breaker + `/system/health/payment` |
| Không trừ tiền 2 lần | `pnpm demo:idempotency -- --attempts=5` |

## 2. Timeline Đề Xuất

Tổng độ dài hợp lý: 20-30 phút. Nếu cần rút gọn, ưu tiên các đoạn có bằng
chứng chạy trực tiếp: register/payment, race/idempotency, AI, CSV, mobile.

| Thời lượng | Nội dung |
| --- | --- |
| 00:00-01:00 | Giới thiệu bài toán và mục tiêu |
| 01:00-03:00 | Code tour kiến trúc và blueprint |
| 03:00-05:00 | Start stack, seed, health, metrics |
| 05:00-08:00 | Student xem catalog, register, QR |
| 08:00-10:00 | Notification email/in-app |
| 10:00-13:00 | Admin CRUD/publish/cancel workshop |
| 13:00-16:00 | Payment + idempotency |
| 16:00-18:00 | Circuit Breaker khi payment gateway lỗi |
| 18:00-21:00 | AI Summary từ PDF |
| 21:00-23:00 | CSV sync legacy |
| 23:00-26:00 | Mobile offline check-in |
| 26:00-29:00 | Race condition + k6 load evidence |
| 29:00-30:00 | Tổng kết theo yêu cầu đề bài |

## 3. Kịch Bản Chi Tiết

### Đoạn 1 - Mở Đầu

Màn hình: mở file HTML đề bài hoặc `blueprint/proposal.md`.

Nói:

> UniHub Workshop số hóa quy trình từ xem lịch, đăng ký, thanh toán, nhận
> notification đến check-in tại sự kiện. Điểm khó của bài là hệ thống phải
> chịu tải đột biến, không trùng ghế, payment có thể lỗi nhưng không làm sập
> các tính năng khác, mobile check-in phải offline được, và CSV legacy chỉ có
> đồng bộ một chiều.

Bằng chứng cần show:

- HTML đề bài các phần "Yêu cầu hệ thống" và "Các thách thức".
- `blueprint/specs/` có spec riêng cho từng tính năng.

### Đoạn 2 - Code Tour Kiến Trúc

Màn hình: `src/README.md`, `src/docker-compose.yml`, `src/apps/backend/src/modules`.

Nói:

> Code hiện tại là modular monolith NestJS. Backend gồm các module auth,
> catalog, registration, payment, notification, checkin, ai-summary và
> csv-sync. Redis dùng cho rate limit, seat counter và idempotency. RabbitMQ
> dùng cho outbox event. Mock payment gateway là service riêng `services/mock-pg`.
> AI Summary gọi Gemini API thật qua `GEMINI_API_KEY`.

Bằng chứng cần show:

- `src/apps/backend/src/modules`.
- `src/apps/backend/prisma/schema.prisma`.
- `src/services/mock-pg`.
- `src/apps/mobile/App.tsx`.

### Đoạn 3 - Start Stack Và Health

Màn hình: terminal.

Lệnh:

```powershell
cd <repo>\src
docker compose --profile all ps
Invoke-RestMethod http://localhost:3000/health
Invoke-WebRequest http://localhost:3000/metrics -UseBasicParsing
```

Nói:

> Stack đang chạy bằng Docker Compose: PostgreSQL, Redis, RabbitMQ, MinIO,
> Mailhog, backend, mock payment gateway và hai web app. Health và metrics
> dùng để chứng minh hệ thống có observability cơ bản.

### Đoạn 4 - Student Catalog, Register Và QR

Màn hình: Student Web `http://localhost:5173`.

Thao tác:

1. Register/login một sinh viên bằng MSSV seed.
2. Mở danh sách workshop.
3. Chọn workshop free.
4. Bấm đăng ký.
5. Show `status=CONFIRMED`, `qrToken` hoặc QR image.

Nói:

> Sinh viên chỉ thấy workshop `PUBLISHED`, có số chỗ còn lại lấy từ Redis seat
> counter. Workshop free sẽ confirm ngay và trả QR token/QR image để dùng cho
> check-in.

Bằng chứng cần show:

- Catalog có workshop free và paid.
- Sau khi đăng ký free có QR.
- Tab khác reload thấy `seatsLeft` giảm.

### Đoạn 5 - Notification

Màn hình: Student Web notification + Mailhog `http://localhost:8025`.

Thao tác:

1. Sau khi đăng ký thành công, mở notification trong app nếu UI có.
2. Mở Mailhog, lọc email mới nhất.

Nói:

> Notification được sinh từ outbox event, worker render template và gửi qua
> email + in-app. Kiến trúc dùng strategy/adapter nên có thể thêm Telegram sau
> mà không sửa module registration/payment.

Bằng chứng cần show:

- Email `registration_confirmed` hoặc `payment_succeeded` trong Mailhog.
- In-app notification hoặc API `GET /notifications/me`.

### Đoạn 6 - Admin CRUD, Publish, Cancel

Màn hình: Admin Web `http://localhost:5174`.

Thao tác:

1. Login `organizer@unihub.local`.
2. Tạo workshop mới.
3. Publish workshop.
4. Sửa giờ/phòng để show optimistic lock/version nếu UI có.
5. Cancel workshop demo nếu cần.

Nói:

> Admin/organizer có quyền tạo, sửa, publish và cancel workshop. Backend có
> RBAC guard, audit log, optimistic lock bằng version và invalidate cache sau
> khi thay đổi.

Bằng chứng cần show:

- Workshop mới xuất hiện ở Student Web sau publish.
- Workshop DRAFT không xuất hiện ở Student Web.
- Cancel workshop chuyển registration liên quan sang `CANCELLED` và publish
  event `workshop.cancelled`.

### Đoạn 7 - Payment Và Idempotency

Màn hình: terminal + Student Web.

Lệnh demo script:

```powershell
cd <repo>\src
pnpm demo:idempotency -- --attempts=5
```

Nói:

> Đây là luồng workshop có phí. Đăng ký tạo `PENDING_PAYMENT` và giữ ghế.
> Khi thanh toán, client bắt buộc gửi `Idempotency-Key`. Script này gửi 5 lần
> cùng một ý định thanh toán, kết quả mong đợi là chỉ có một charge thật ở mock
> payment gateway và các response replay cùng snapshot.

Bằng chứng cần show:

- Output script có attempts=5.
- Cùng `paymentId`/`gatewayTxnId` hoặc chỉ một payment success.
- Registration cuối cùng `CONFIRMED` và có QR.

### Đoạn 8 - Circuit Breaker Và Graceful Degradation

Màn hình: terminal + health endpoint.

Thao tác gợi ý:

```powershell
Invoke-RestMethod http://localhost:3000/system/health/payment
```

Để demo gateway lỗi, dùng biến môi trường của mock PG hoặc stop service mock-pg
tạm thời:

```powershell
docker compose stop mock-pg
Invoke-RestMethod http://localhost:3000/system/health/payment
```

Sau demo, bật lại:

```powershell
docker compose start mock-pg
```

Nói:

> Khi payment gateway lỗi liên tục, circuit breaker mở và `POST /payments` fail
> fast 503. Các tính năng khác như catalog, đăng ký free, AI, CSV và check-in
> vẫn hoạt động. Đây là graceful degradation theo yêu cầu đề bài.

Bằng chứng cần show:

- `/system/health/payment` chuyển `open` sau các lỗi payment.
- `GET /workshops` vẫn 200.
- Payment request trả 503 nhanh.

### Đoạn 9 - AI Summary Từ PDF

Màn hình: Admin Web + terminal.

Lệnh smoke:

```powershell
cd <repo>\src
powershell -ExecutionPolicy Bypass -File scripts/smoke-ai-summary.ps1
```

Hoặc thao tác UI:

1. Login organizer.
2. Chọn workshop.
3. Upload `scripts/ai/ai_sum_test_1.pdf`.
4. Poll status đến `READY`.
5. Reload Student Web detail để thấy summary/highlights.

Nói:

> Admin upload PDF, backend validate MIME và magic bytes, lưu MinIO, tạo outbox
> `workshop.pdf.uploaded`. Worker lấy PDF, extract text bằng `pdfjs-dist`, gọi
> Gemini API theo response schema, sau đó cache theo SHA-256 để upload lại cùng
> file không gọi Gemini lần nữa.

Bằng chứng cần show:

- `summaryStatus=PENDING` rồi `READY`.
- Summary tiếng Việt 180-280 từ và 5 highlights.
- Cache hit khi upload lại cùng PDF.

### Đoạn 10 - CSV Sync Legacy

Màn hình: terminal + Admin Web import jobs nếu có.

Lệnh:

```powershell
cd <repo>\src
powershell -ExecutionPolicy Bypass -File scripts/smoke-csv-sync.ps1
```

Nếu chạy backend local bằng `pnpm dev:backend` thay vì Docker:

```powershell
$env:UNIHUB_CSV_DATA_ROOT = "apps/backend/data"
powershell -ExecutionPolicy Bypass -File scripts/smoke-csv-sync.ps1
```

Thao tác nên quay:

1. Mở `blueprint/specs/csv-sync.md`, chỉ đoạn hệ thống cũ export CSV vào
   `data/csv-drop/`.
2. Mở Admin Web, login `admin@unihub.local`, vào menu **CSV import**.
3. Chạy `scripts/smoke-csv-sync.ps1`.
4. Show terminal các dòng `[OK] SUCCESS`, `duplicate skipped`,
   `FAILED + file in quarantine`, `PARTIAL`.
5. Show `src/data/csv-archive` có file đã import và `src/data/csv-quarantine`
   có file lỗi header.

Nói:

> Hệ thống sinh viên cũ không có API, nên UniHub dùng tích hợp một chiều qua
> CSV. Worker đọc file trong `csv-drop`, tính SHA-256 để chống import trùng,
> validate header và từng dòng, insert staging theo batch 1000, upsert vào
> bảng `students`, rồi archive file thành công hoặc quarantine file lỗi. Cron
> mặc định chạy 02:00, còn demo dùng endpoint admin trigger thủ công.

Bằng chứng cần show:

- Valid CSV: job `SUCCESS`, file vào `data/csv-archive`.
- Drop lại cùng SHA: skip duplicate, không tạo job mới.
- Bad header: job `FAILED`, file vào `data/csv-quarantine`.
- Partial invalid rows: job `PARTIAL`, có `errorLog.failedRows`.

### Đoạn 11 - Mobile Offline Check-in

Màn hình: Expo mobile app hoặc emulator.

Thao tác:

1. Login `staff@unihub.local`.
2. App fetch/cache `GET /auth/jwks`.
3. Dùng QR token từ registration confirmed.
4. Tắt mạng/airplane mode.
5. Queue scan offline.
6. Bật mạng lại, app tự sync `POST /checkin/batch`.

Nói:

> Mobile verify QR offline bằng public key RS256 đã cache, ghi vào SQLite
> `pending_scans` với WAL mode. Khi online trở lại, app sync batch lên backend.
> Mỗi item có `idempotencyKey`, nên retry không tạo check-in trùng.

Bằng chứng cần show:

- Offline queue tăng lên.
- Sau khi online, queue sync thành công.
- Backend/Student notification có `checkin_succeeded`.

Nếu không quay được emulator, mở `src/scripts/demo/offline-checkin.md` và quay
thêm terminal/API evidence, nhưng nên ưu tiên app thật.

### Đoạn 12 - Race Condition Và Load

Màn hình: terminal.

Lệnh race:

```powershell
cd <repo>\src
pnpm demo:race -- --clients=100
```

Nói:

> Script tạo workshop capacity=1 và 100 sinh viên đăng ký đồng thời. Kỳ vọng
> chỉ 1 request thành công, 99 request còn lại `sold_out` hoặc được xử lý đúng,
> không có seat âm và không có hai sinh viên cùng nhận ghế cuối.

Bằng chứng cần show:

- Output script: capacity=1, success=1.

Lệnh hoặc evidence k6:

```powershell
Get-Content scripts/outputs/k6-12k-summary.json
Get-Content scripts/outputs/k6-12k-output.txt -TotalCount 80
```

Nói:

> Phần 12K/10 phút được demo bằng k6 script và output đã lưu. Script tạo token
> sinh viên, workshop load test, và đo response trong điều kiện 60% traffic dồn
> vào đầu đợt mở đăng ký.

Bằng chứng cần show:

- `scripts/k6/registration-12k-10m.js`.
- `scripts/outputs/k6-12k-summary.json`.
- Metrics/rate limit endpoint nếu cần.

### Đoạn 13 - Tổng Kết

Màn hình: quay lại `blueprint/specs/` và app đang chạy.

Nói:

> Video đã demo đủ các chức năng theo đề bài: student xem và đăng ký workshop,
> notification, admin quản trị, mobile check-in offline, AI Summary và CSV sync.
> Các thách thức kỹ thuật được hiện thực bằng Redis seat counter, rate limiting
> + queue, idempotency, circuit breaker, outbox/RabbitMQ, SQLite offline queue
> và Gemini AI provider thật.

Checklist trước khi kết thúc:

- Health/metrics vẫn OK.
- Đã bật lại `mock-pg` nếu trước đó stop.
- Video có camera thành viên.
- Video xuất MP4 và đặt vào `clips/`.

## 4. Các Lệnh Nhanh Cần Copy Khi Quay

```powershell
cd <repo>\src
docker compose --profile all ps
Invoke-RestMethod http://localhost:3000/health
Invoke-WebRequest http://localhost:3000/metrics -UseBasicParsing
Invoke-RestMethod http://localhost:3000/system/health/payment
pnpm demo:race -- --clients=100
pnpm demo:idempotency -- --attempts=5
powershell -ExecutionPolicy Bypass -File scripts/smoke-ai-summary.ps1
powershell -ExecutionPolicy Bypass -File scripts/smoke-csv-sync.ps1
Get-Content scripts/outputs/k6-12k-summary.json
```

## 5. Lời Khuyên Khi Quay

- Quay từng đoạn ngắn, đặt tên file như `clips/01-intro.mp4`,
  `clips/02-student-register.mp4`, rồi ghép sau.
- Khi một script mất thời gian, nói trước "tôi đang chạy smoke script" và show
  output cuối cùng thay vì để màn hình chờ quá lâu.
- Nếu AI chậm do quota/network, show `summaryStatus=FAILED` + error và nói rõ
  hệ thống vẫn degrade an toàn; nếu có key hợp lệ thì quay lại đoạn READY.
- Nếu k6 12K quá nặng cho máy quay, show script + output đã lưu, sau đó chạy
  smoke nhỏ để chứng minh có thể lặp lại quy trình.
