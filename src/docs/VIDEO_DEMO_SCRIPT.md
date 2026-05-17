# UniHub Workshop - Kich Ban Quay Video Demo

File nay la kich ban quay video nop bai cho yeu cau trong
`ĐỒ ÁN MÔN HỌC – UniHub Workshop _ software-design-docs.html`.

Muc tieu video:

- Demo truc tiep tren code hoac ung dung dang chay, khong lam slide thuan tuy.
- Co camera thanh vien thuyet trinh.
- Video dat trong thu muc `clips/`, dinh dang MP4, FullHD 1080p, bitrate khoang
  720 kbps.
- Bao phu du cac chuc nang: xem/dang ky workshop, notification, admin,
  check-in, AI Summary, CSV sync.
- Chung minh cac van de ky thuat: tranh trung ghe, tai dot bien 12K/10 phut,
  payment khong on dinh, idempotency, offline check-in, CSV legacy one-way.

## 0. Chuan Bi Truoc Khi Quay

Chay tu thu muc `src`:

```powershell
cd <repo>\src
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm install
pnpm stack:up
docker compose --profile all exec backend pnpm run seed
docker compose --profile all ps
```

Neu demo AI Summary that, dat `GEMINI_API_KEY` trong `src/.env` truoc khi
`pnpm stack:up` hoac recreate backend:

```powershell
docker compose --profile all up -d --build backend
```

Mo san cac tab:

| Tab | URL / File |
| --- | --- |
| Student Web | http://localhost:5173 |
| Admin Web | http://localhost:5174 |
| Backend health | http://localhost:3000/health |
| Metrics | http://localhost:3000/metrics |
| Mailhog | http://localhost:8025 |
| RabbitMQ UI | http://localhost:15672 |
| MinIO Console | http://localhost:9001 |
| Blueprint | `blueprint/design.md` va `blueprint/specs/` |
| Test runbook | `src/docs/TESTING_DEMO_SCRIPTS.md` |

Tai khoan seed:

| Role | Email | Password |
| --- | --- | --- |
| SYS_ADMIN | `admin@unihub.local` | `Admin@123456` |
| ORGANIZER | `organizer@unihub.local` | `Test@12345` |
| CHECKIN_STAFF | `staff@unihub.local` | `Test@12345` |

Sinh vien dung Student Web de register voi MSSV mau:
`21120001..21120006`, `22120004..22120005`.

## 1. Mapping Yeu Cau De Bai Vao Doan Quay

| Yeu cau trong de bai | Doan quay nen co |
| --- | --- |
| Xem lich workshop, so cho real-time | Student Web catalog + SSE `/workshops/stream` |
| Dang ky workshop, nhan QR | Student Web dang ky workshop free/paid |
| Notification app/email | In-app notification + Mailhog |
| Admin tao/sua/huy workshop | Admin Web CRUD/publish/cancel |
| Check-in bang mobile, ho tro offline | Expo mobile + SQLite queue + sync |
| AI Summary tu PDF | Admin upload PDF + Gemini summary READY |
| Dong bo CSV legacy | `smoke-csv-sync.ps1`, import_jobs, quarantine/archive |
| Tranh chap ghe | `pnpm demo:race -- --clients=100` |
| Tai dot bien 12K/10 phut | Show k6 script/output `k6-12k-summary.json` |
| Payment khong on dinh | Mock PG + Circuit Breaker + `/system/health/payment` |
| Khong tru tien 2 lan | `pnpm demo:idempotency -- --attempts=5` |

## 2. Timeline De Xuat

Tong do dai hop ly: 20-30 phut. Neu can rut gon, uu tien cac doan co bang
chung chay truc tiep: register/payment, race/idempotency, AI, CSV, mobile.

| Thoi luong | Noi dung |
| --- | --- |
| 00:00-01:00 | Gioi thieu bai toan va muc tieu |
| 01:00-03:00 | Code tour kien truc va blueprint |
| 03:00-05:00 | Start stack, seed, health, metrics |
| 05:00-08:00 | Student xem catalog, register, QR |
| 08:00-10:00 | Notification email/in-app |
| 10:00-13:00 | Admin CRUD/publish/cancel workshop |
| 13:00-16:00 | Payment + idempotency |
| 16:00-18:00 | Circuit Breaker khi payment gateway loi |
| 18:00-21:00 | AI Summary tu PDF |
| 21:00-23:00 | CSV sync legacy |
| 23:00-26:00 | Mobile offline check-in |
| 26:00-29:00 | Race condition + k6 load evidence |
| 29:00-30:00 | Tong ket theo yeu cau de bai |

## 3. Kich Ban Chi Tiet

### Doan 1 - Mo Dau

Man hinh: mo file HTML de bai hoac `blueprint/proposal.md`.

Noi:

> UniHub Workshop so hoa quy trinh tu xem lich, dang ky, thanh toan, nhan
> notification den check-in tai su kien. Diem kho cua bai la he thong phai
> chiu tai dot bien, khong trung ghe, payment co the loi nhung khong lam sap
> cac tinh nang khac, mobile check-in phai offline duoc, va CSV legacy chi co
> dong bo mot chieu.

Bang chung can show:

- HTML de bai cac phan "Yeu cau he thong" va "Cac thach thuc".
- `blueprint/specs/` co spec rieng cho tung tinh nang.

### Doan 2 - Code Tour Kien Truc

Man hinh: `src/README.md`, `src/docker-compose.yml`, `src/apps/backend/src/modules`.

Noi:

> Code hien tai la modular monolith NestJS. Backend gom cac module auth,
> catalog, registration, payment, notification, checkin, ai-summary va
> csv-sync. Redis dung cho rate limit, seat counter va idempotency. RabbitMQ
> dung cho outbox event. Mock payment gateway la service rieng `services/mock-pg`.
> AI Summary goi Gemini API that qua `GEMINI_API_KEY`.

Bang chung can show:

- `src/apps/backend/src/modules`.
- `src/apps/backend/prisma/schema.prisma`.
- `src/services/mock-pg`.
- `src/apps/mobile/App.tsx`.

### Doan 3 - Start Stack Va Health

Man hinh: terminal.

Lenh:

```powershell
cd <repo>\src
docker compose --profile all ps
Invoke-RestMethod http://localhost:3000/health
Invoke-WebRequest http://localhost:3000/metrics -UseBasicParsing
```

Noi:

> Stack dang chay bang Docker Compose: PostgreSQL, Redis, RabbitMQ, MinIO,
> Mailhog, backend, mock payment gateway va hai web app. Health va metrics
> dung de chung minh he thong co observability co ban.

### Doan 4 - Student Catalog, Register Va QR

Man hinh: Student Web `http://localhost:5173`.

Thao tac:

1. Register/login mot sinh vien bang MSSV seed.
2. Mo danh sach workshop.
3. Chon workshop free.
4. Bam dang ky.
5. Show `status=CONFIRMED`, `qrToken` hoac QR image.

Noi:

> Sinh vien chi thay workshop `PUBLISHED`, co so cho con lai lay tu Redis seat
> counter. Workshop free se confirm ngay va tra QR token/QR image de dung cho
> check-in.

Bang chung can show:

- Catalog co workshop free va paid.
- Sau khi dang ky free co QR.
- Tab khac reload thay `seatsLeft` giam.

### Doan 5 - Notification

Man hinh: Student Web notification + Mailhog `http://localhost:8025`.

Thao tac:

1. Sau khi dang ky thanh cong, mo notification trong app neu UI co.
2. Mo Mailhog, loc email moi nhat.

Noi:

> Notification duoc sinh tu outbox event, worker render template va gui qua
> email + in-app. Kien truc dung strategy/adapter nen co the them Telegram sau
> ma khong sua module registration/payment.

Bang chung can show:

- Email `registration_confirmed` hoac `payment_succeeded` trong Mailhog.
- In-app notification hoac API `GET /notifications/me`.

### Doan 6 - Admin CRUD, Publish, Cancel

Man hinh: Admin Web `http://localhost:5174`.

Thao tac:

1. Login `organizer@unihub.local`.
2. Tao workshop moi.
3. Publish workshop.
4. Sua gio/phong de show optimistic lock/version neu UI co.
5. Cancel workshop demo neu can.

Noi:

> Admin/organizer co quyen tao, sua, publish va cancel workshop. Backend co
> RBAC guard, audit log, optimistic lock bang version va invalidate cache sau
> khi thay doi.

Bang chung can show:

- Workshop moi xuat hien o Student Web sau publish.
- Workshop DRAFT khong xuat hien o Student Web.
- Cancel workshop chuyen registration lien quan sang `CANCELLED` va publish
  event `workshop.cancelled`.

### Doan 7 - Payment Va Idempotency

Man hinh: terminal + Student Web.

Lenh demo script:

```powershell
cd <repo>\src
pnpm demo:idempotency -- --attempts=5
```

Noi:

> Day la luong workshop co phi. Dang ky tao `PENDING_PAYMENT` va giu ghe.
> Khi thanh toan, client bat buoc gui `Idempotency-Key`. Script nay gui 5 lan
> cung mot y dinh thanh toan, ket qua mong doi la chi co mot charge that o mock
> payment gateway va cac response replay cung snapshot.

Bang chung can show:

- Output script co attempts=5.
- Cung `paymentId`/`gatewayTxnId` hoac chi mot payment success.
- Registration cuoi cung `CONFIRMED` va co QR.

### Doan 8 - Circuit Breaker Va Graceful Degradation

Man hinh: terminal + health endpoint.

Thao tac goi y:

```powershell
Invoke-RestMethod http://localhost:3000/system/health/payment
```

De demo gateway loi, dung bien moi truong cua mock PG hoac stop service mock-pg
tam thoi:

```powershell
docker compose stop mock-pg
Invoke-RestMethod http://localhost:3000/system/health/payment
```

Sau demo, bat lai:

```powershell
docker compose start mock-pg
```

Noi:

> Khi payment gateway loi lien tuc, circuit breaker mo va `POST /payments` fail
> fast 503. Cac tinh nang khac nhu catalog, dang ky free, AI, CSV va check-in
> van hoat dong. Day la graceful degradation theo yeu cau de bai.

Bang chung can show:

- `/system/health/payment` chuyen `open` sau cac loi payment.
- `GET /workshops` van 200.
- Payment request tra 503 nhanh.

### Doan 9 - AI Summary Tu PDF

Man hinh: Admin Web + terminal.

Lenh smoke:

```powershell
cd <repo>\src
powershell -ExecutionPolicy Bypass -File scripts/smoke-ai-summary.ps1
```

Hoac thao tac UI:

1. Login organizer.
2. Chon workshop.
3. Upload `scripts/ai/ai_sum_test_1.pdf`.
4. Poll status den `READY`.
5. Reload Student Web detail de thay summary/highlights.

Noi:

> Admin upload PDF, backend validate MIME va magic bytes, luu MinIO, tao outbox
> `workshop.pdf.uploaded`. Worker lay PDF, extract text bang `pdfjs-dist`, goi
> Gemini API theo response schema, sau do cache theo SHA-256 de upload lai cung
> file khong goi Gemini lan nua.

Bang chung can show:

- `summaryStatus=PENDING` roi `READY`.
- Summary tieng Viet 180-280 tu va 5 highlights.
- Cache hit khi upload lai cung PDF.

### Doan 10 - CSV Sync Legacy

Man hinh: terminal + Admin Web import jobs neu co.

Lenh:

```powershell
cd <repo>\src
powershell -ExecutionPolicy Bypass -File scripts/smoke-csv-sync.ps1
```

Noi:

> He thong cu khong co API, nen backend doc CSV tu `data/csv-drop`. Worker tinh
> SHA-256 de skip file trung, validate header/row, insert staging theo batch
> 1000, upsert vao `students`, archive file thanh cong va quarantine file loi.

Bang chung can show:

- File CSV duoc archive sau import thanh cong.
- `import_jobs` co `SUCCESS` hoac `PARTIAL`.
- File sai header vao quarantine va notification SYS_ADMIN/email neu smoke co.

### Doan 11 - Mobile Offline Check-in

Man hinh: Expo mobile app hoac emulator.

Thao tac:

1. Login `staff@unihub.local`.
2. App fetch/cache `GET /auth/jwks`.
3. Dung QR token tu registration confirmed.
4. Tat mang/airplane mode.
5. Queue scan offline.
6. Bat mang lai, app tu sync `POST /checkin/batch`.

Noi:

> Mobile verify QR offline bang public key RS256 da cache, ghi vao SQLite
> `pending_scans` voi WAL mode. Khi online tro lai, app sync batch len backend.
> Moi item co `idempotencyKey`, nen retry khong tao check-in trung.

Bang chung can show:

- Offline queue tang len.
- Sau khi online, queue sync thanh cong.
- Backend/Student notification co `checkin_succeeded`.

Neu khong quay duoc emulator, mo `src/scripts/demo/offline-checkin.md` va quay
them terminal/API evidence, nhung nen uu tien app that.

### Doan 12 - Race Condition Va Load

Man hinh: terminal.

Lenh race:

```powershell
cd <repo>\src
pnpm demo:race -- --clients=100
```

Noi:

> Script tao workshop capacity=1 va 100 sinh vien dang ky dong thoi. Ky vong
> chi 1 request thanh cong, 99 request con lai `sold_out` hoac duoc xu ly dung,
> khong co seat am va khong co hai sinh vien cung nhan ghe cuoi.

Bang chung can show:

- Output script: capacity=1, success=1.

Lenh hoac evidence k6:

```powershell
Get-Content scripts/outputs/k6-12k-summary.json
Get-Content scripts/outputs/k6-12k-output.txt -TotalCount 80
```

Noi:

> Phan 12K/10 phut duoc demo bang k6 script va output da luu. Script tao token
> sinh vien, workshop load test, va do response trong dieu kien 60% traffic don
> vao dau dot mo dang ky.

Bang chung can show:

- `scripts/k6/registration-12k-10m.js`.
- `scripts/outputs/k6-12k-summary.json`.
- Metrics/rate limit endpoint neu can.

### Doan 13 - Tong Ket

Man hinh: quay lai `blueprint/specs/` va app dang chay.

Noi:

> Video da demo du cac chuc nang theo de bai: student xem va dang ky workshop,
> notification, admin quan tri, mobile check-in offline, AI Summary va CSV sync.
> Cac thach thuc ky thuat duoc hien thuc bang Redis seat counter, rate limiting
> + queue, idempotency, circuit breaker, outbox/RabbitMQ, SQLite offline queue
> va Gemini AI provider that.

Checklist truoc khi ket thuc:

- Health/metrics van OK.
- Da bat lai `mock-pg` neu truoc do stop.
- Video co camera thanh vien.
- Video xuat MP4 va dat vao `clips/`.

## 4. Cac Lenh Nhanh Can Copy Khi Quay

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

## 5. Loi Khuyen Khi Quay

- Quay tung doan ngan, dat ten file nhu `clips/01-intro.mp4`,
  `clips/02-student-register.mp4`, roi ghep sau.
- Khi mot script mat thoi gian, noi truoc "toi dang chay smoke script" va show
  output cuoi cung thay vi de man hinh cho qua lau.
- Neu AI cham do quota/network, show `summaryStatus=FAILED` + error va noi ro
  he thong van degrade an toan; neu co key hop le thi quay lai doan READY.
- Neu k6 12K qua nang cho may quay, show script + output da luu, sau do chay
  smoke nho de chung minh co the lap lai quy trinh.
