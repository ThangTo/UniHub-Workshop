# UniHub Workshop - Huong Dan Test Demo Scripts Va Load

Tai lieu nay dung de chay test/demo va thu thap bang chung nop bai theo yeu
cau trong file de bai HTML:

- Source `src/` phai chay duoc bang README/runbook.
- Co seed data hoac script tao du lieu mau.
- Demo truc tiep tren code/app dang chay, khong chi mo phong tren slide.
- Chung minh cac co che ky thuat da thiet ke: concurrency, idempotency,
  circuit breaker, notification, offline check-in, AI summary, CSV sync va
  observability.

Tat ca lenh ben duoi chay tu thu muc `src`:

```powershell
cd <repo>\src
```

Neu can kich ban quay video theo de bai, xem `docs/VIDEO_DEMO_SCRIPT.md`.

## 1. Kiem Tra Build, Lint, Unit Test

Chay truoc khi quay demo hoac nop source:

```powershell
pnpm install
pnpm build
pnpm lint
pnpm test
docker compose --profile all config --quiet
docker compose --profile all build
```

Expected:

- Backend, mobile, student-web, admin-web, mock-pg, mock-ai build xanh.
- TypeScript lint/typecheck xanh.
- `pnpm test` hien tai chay Vitest cho backend, gom:
  - `apps/backend/src/modules/catalog/catalog.service.spec.ts`
  - `apps/backend/src/modules/payment/payment-refund.service.spec.ts`
- Docker compose config/build xanh.

Neu chi can test nhanh unit backend:

```powershell
pnpm --filter ./apps/backend test
```

## 2. Start Stack Va Seed Data

Docker full stack khong bat buoc co `.env`, vi `docker-compose.yml` da co default
dev values. Tuy nhien AI summary dung Gemini API that, nen neu can test AI bang
Docker Compose thi set `GEMINI_API_KEY` trong `src/.env` truoc khi start/recreate
backend. Neu chay backend local bang `pnpm dev:backend`, set key trong
`src/apps/backend/.env`.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Sua .env neu can: GEMINI_API_KEY, JWT_PRIVATE_KEY/JWT_PUBLIC_KEY, port...
pnpm stack:up
docker compose --profile all exec backend pnpm run seed
docker compose --profile all ps
```

Expected services voi `--profile all`:

- `unihub-postgres`: healthy
- `unihub-redis`: healthy
- `unihub-rabbitmq`: healthy
- `unihub-minio`: healthy
- `unihub-mailhog`: up
- `unihub-backend`: healthy
- `unihub-mock-pg`: up
- `unihub-student-web`: up
- `unihub-admin-web`: up

Luu y: `services/mock-ai` la legacy service. Code AI summary hien tai goi
Gemini truc tiep qua `GEMINI_API_KEY`, khong goi mock-ai trong full stack.

Kiem tra backend:

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-WebRequest http://localhost:3000/metrics -UseBasicParsing
```

Tai khoan seed chinh:

| Vai tro | Email | Password |
| --- | --- | --- |
| SYS_ADMIN | `admin@unihub.local` | `Admin@123456` |
| ORGANIZER | `organizer@unihub.local` | `Test@12345` |
| CHECKIN_STAFF | `staff@unihub.local` | `Test@12345` |

## 3. Smoke Test AI Summary

Muc tieu: chung minh flow PDF -> MinIO -> RabbitMQ worker -> Gemini -> cache
theo SHA-256.

Preconditions:

- Stack da running va seed da chay.
- Backend co `GEMINI_API_KEY` hop le.
- PDF mau ton tai tai `scripts/test-workshop.pdf`.

Neu thieu PDF mau:

```powershell
node scripts/make-test-pdf.js
```

Chay smoke:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-ai-summary.ps1
```

Expected:

- Login organizer thanh cong.
- Tao/chon workshop thanh cong.
- Upload PDF tra `PENDING` hoac `READY` neu cache hit.
- Poll `GET /workshops/{id}/summary` den `READY`.
- Summary co noi dung tieng Viet va highlights.
- Re-upload cung PDF tra `cacheHit=true`, `READY` ngay.

Neu status `FAILED`, kiem tra `summaryHighlights.error`. Loi thuong gap:

- `gemini_api_key_missing`: chua set `GEMINI_API_KEY`.
- `gemini_401`/`gemini_403`: key sai hoac chua enable API.
- `gemini_429`: quota/rate limit.
- `text_too_short`: PDF khong du noi dung.

Sau khi sua env/key, restart backend va goi Retry Summary tren Admin Web hoac
API `POST /workshops/{id}/summary/retry`:

```powershell
docker compose --profile all up -d --force-recreate backend
```

## 4. Smoke Test CSV Sync

Muc tieu: chung minh sync danh sach sinh vien tu CSV, co archive/quarantine va
skip duplicate theo SHA.

Chay voi Docker backend:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-csv-sync.ps1
```

Script mac dinh ghi file vao `src/data/csv-*`, khop voi volume mount cua backend
Docker. Neu chay backend local bang `pnpm dev:backend`, backend dung
`apps/backend/data/csv-*`; khi do set:

```powershell
$env:UNIHUB_CSV_DATA_ROOT = "apps/backend/data"
powershell -ExecutionPolicy Bypass -File scripts/smoke-csv-sync.ps1
```

Expected:

- Valid CSV: job `SUCCESS`.
- Re-drop cung SHA: skip, khong tao job moi.
- Bad header: job `FAILED`, file vao quarantine.
- Partial invalid rows: job `PARTIAL`, co `errorLog.failedRows`.

## 5. Demo Race Condition: Nhieu Client Tranh 1 Ghe

Muc tieu: chung minh seat allocation atomic, khong oversell.

Demo script tao token truc tiep bang private key, vi vay backend va script phai
dung cung `JWT_PRIVATE_KEY/JWT_PUBLIC_KEY`. Nen set stable JWT key trong
`src/.env` hoac `src/apps/backend/.env` truoc khi start backend.

Tao RSA key pair de paste vao env:

```powershell
node -e "const {generateKeyPairSync}=require('crypto'); const {privateKey, publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}); console.log('JWT_PRIVATE_KEY=' + JSON.stringify(privateKey)); console.log('JWT_PUBLIC_KEY=' + JSON.stringify(publicKey));"
```

Restart backend sau khi sua key:

```powershell
docker compose --profile all up -d --force-recreate backend
```

Chay 100 clients:

```powershell
pnpm demo:race -- --clients=100
```

Co the tang toi 1000 clients:

```powershell
pnpm demo:race -- --clients=1000
```

Expected output:

```text
[race] workshop=... capacity=1
[race] http winners=1 ...
[race] dbActive=1 seatsLeft=0
[race] PASS: concurrent registration did not oversell the final seat.
```

Fail nghiem trong neu `winners > 1` hoac `dbActive > 1`.

## 6. Demo Idempotency Payment

Muc tieu: chung minh double click/retry `POST /payments` cung
`Idempotency-Key` khong tao double charge.

Preconditions:

- Backend running.
- `mock-pg` running.
- Stable JWT key nhu muc race condition.

Chay:

```powershell
pnpm demo:idempotency -- --attempts=5
```

Expected:

```text
[idempotency] dbPaymentsWithKey=1
[idempotency] PASS: repeated POST /payments with one key produced one durable payment record.
```

Fail neu co nhieu payment row cho cung `Idempotency-Key` hoac response tra
nhieu `paymentId` khac nhau.

## 7. Circuit Breaker Payment

Muc tieu: chung minh payment gateway loi khong lam sap registration/web, backend
tra loi co kiem soat va co retry/refund path.

Duong demo nhanh:

1. Start stack va seed.
2. Tao workshop co phi tren Admin Web.
3. Dang ky workshop do bang Student Web.
4. Tat mock payment gateway:

```powershell
docker compose stop mock-pg
```

5. Thu thanh toan tren Student Web.

Expected:

- Backend khong crash.
- Payment fail co thong bao ro rang.
- Sau nhieu lan fail, circuit breaker open va fail fast.
- Khi start lai mock-pg, gateway co the phuc hoi sau reset timeout.

Start lai mock-pg:

```powershell
docker compose --profile all up -d mock-pg
```

Evidence nen chup: Student Web payment error, backend logs, `/metrics`,
Mailhog/notifications neu co event lien quan.

## 8. K6 Registration Load Test

Scripts:

```text
scripts/k6/registration-load.js
scripts/k6/registration-12k-10m.js
```

Can cai `k6`:

```powershell
k6 version
```

Neu chua co, cai theo huong dan chinh thuc cua k6 hoac dung Chocolatey:

```powershell
choco install k6
```

### 8.1 Chuan Bi 12.000 Student Tokens

Muc tieu success criteria:

- 12.000 request trong 10 phut dau.
- 7.200 request trong 3 phut dau.
- 4.800 request con lai trong 7 phut tiep theo.
- Moi request dung token cua sinh vien khac nhau de co bang chung fairness.

Voi demo 12K, nen cau hinh backend:

```env
RATE_LIMIT_GLOBAL_REGISTRATION_RPS=10
RATE_LIMIT_REGQUEUE_TTL_SECONDS=1800
RATE_LIMIT_REGQUEUE_MAX_ITEMS=200000
JWT_ACCESS_TTL=2h
```

Restart backend:

```powershell
docker compose --profile all up -d --force-recreate backend
```

Tao workshop rieng cho load test, capacity >= 12.000:

```powershell
$env:API_BASE_URL = "http://localhost:3000"
pnpm demo:k6:workshop -- --capacity=15000 --out=scripts/outputs/k6-12k-workshop.json
```

Copy `WORKSHOP_ID` script in ra:

```powershell
$env:WORKSHOP_ID = "paste-workshop-id-here"
```

Tao 12.000 student account + access token:

```powershell
$env:API_BASE_URL = "http://localhost:3000"
$env:K6_TOKEN_TTL = "2h"
pnpm demo:k6:tokens -- --count=12000 --out=scripts/outputs/k6-12k-tokens.json
```

File token duoc `open()` tu thu muc cua script k6, nen duong dan token khi chay
k6 la:

```powershell
$env:TOKENS_FILE = "../outputs/k6-12k-tokens.json"
```

Luu y tren Windows: neu k6/Go resolve `localhost` ve IPv4 trong khi backend
Docker bind khac ky vong, co the gap loi JWT/ket noi. Khi do dung:

```powershell
$env:API_BASE_URL = "http://[::1]:3000"
```

### 8.2 Smoke Test 10 Giay

```powershell
$env:API_BASE_URL = "http://[::1]:3000"
$env:TOKENS_FILE = "../outputs/k6-12k-tokens.json"
$env:BURST_RATE = "20"
$env:BURST_DURATION = "5s"
$env:BURST_PREALLOCATED_VUS = "20"
$env:BURST_MAX_VUS = "80"
$env:BURST_EXPECTED_ITERATIONS = "100"
$env:TAIL_RATE = "10"
$env:TAIL_TIME_UNIT = "1s"
$env:TAIL_DURATION = "5s"
$env:TAIL_START_TIME = "5s"
$env:TAIL_PREALLOCATED_VUS = "10"
$env:TAIL_MAX_VUS = "50"
k6 run --summary-export scripts/outputs/k6-12k-smoke-summary.json scripts/k6/registration-12k-10m.js
```

Expected:

- `registration_handled_response` > 0.95.
- `registration_unexpected_5xx` gan 0.
- Response duoc handle bang `201`, `202`, `409`, `429` hoac
  `503 registration_queue_full`.

### 8.3 Full 12.000 Request / 10 Phut

```powershell
$env:API_BASE_URL = "http://[::1]:3000"
$env:TOKENS_FILE = "../outputs/k6-12k-tokens.json"
# $env:WORKSHOP_ID da set tu buoc tao workshop

Remove-Item Env:BURST_RATE -ErrorAction SilentlyContinue
Remove-Item Env:BURST_DURATION -ErrorAction SilentlyContinue
Remove-Item Env:BURST_PREALLOCATED_VUS -ErrorAction SilentlyContinue
Remove-Item Env:BURST_MAX_VUS -ErrorAction SilentlyContinue
Remove-Item Env:BURST_EXPECTED_ITERATIONS -ErrorAction SilentlyContinue
Remove-Item Env:TAIL_RATE -ErrorAction SilentlyContinue
Remove-Item Env:TAIL_TIME_UNIT -ErrorAction SilentlyContinue
Remove-Item Env:TAIL_DURATION -ErrorAction SilentlyContinue
Remove-Item Env:TAIL_START_TIME -ErrorAction SilentlyContinue
Remove-Item Env:TAIL_PREALLOCATED_VUS -ErrorAction SilentlyContinue
Remove-Item Env:TAIL_MAX_VUS -ErrorAction SilentlyContinue

k6 run --summary-export scripts/outputs/k6-12k-summary.json scripts/k6/registration-12k-10m.js
```

Expected:

- Tong HTTP requests xap xi 12.000.
- Phase 1: 40 req/s trong 3 phut, tuong duong 7.200 request.
- Phase 2: 80 req / 7s trong 7 phut, tuong duong 4.800 request.
- Backend khong crash.
- `registration_unexpected_5xx` thap, khong co 5xx bat ngo.
- Khi capacity >= 12.000 va token file co 12.000 token, mot phan request
  `201`, phan vuot nguong global RPS duoc `202 QUEUED` cong bang theo token.

## 9. Offline Check-in Demo

Runbook chi tiet:

```text
scripts/demo/offline-checkin.md
docs/TESTING_MOBILE_EXPO.md
```

Tom tat:

1. Start stack va seed.
2. Tao student registration `CONFIRMED` va mo QR.
3. Start Expo app.
4. Login staff.
5. Tat mang.
6. Scan QR, item vao SQLite queue.
7. Bat mang lai.
8. NetInfo auto-sync queue len `POST /checkin/batch`.

Expected:

- Offline scan verify duoc QR bang JWKS da cache.
- Queue ben vung qua app restart.
- Sync online tao dung 1 row `checkins`.
- Scan trung khong tao row thu hai.

## 10. Evidence Cho Bao Cao Va Video

Sau khi chay demo, lay evidence:

```powershell
Invoke-WebRequest http://localhost:3000/metrics -UseBasicParsing
docker compose --profile all ps
```

Kiem tra DB nhanh:

```powershell
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select status, count(*) from registrations group by status;"
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select status, count(*) from payments group by status;"
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select status, count(*) from import_jobs group by status;"
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select count(*) from checkins;"
```

Nen chup/quay:

- `pnpm build`, `pnpm lint`, `pnpm test` thanh cong.
- Docker full stack healthy.
- Student Web: list/detail/register/payment/QR.
- Admin Web: CRUD/publish workshop, AI summary, CSV import jobs,
  registrations/check-ins/staff assignments.
- Mailhog email/notification.
- Mobile: offline queue va sync lai.
- Terminal PASS cua race/idempotency.
- K6 summary va file `scripts/outputs/k6-12k-summary.json`.
- `/metrics` co Prometheus metrics.

## 11. Checklist Theo Yeu Cau De Bai

| Tieu chi | Bang chung nen dung |
| --- | --- |
| Source chay duoc | `src/README.md`, `docs/TESTING_WEB_API.md`, Docker stack healthy |
| Seed/sample data | `pnpm db:seed`, `apps/backend/src/seed/seed.ts`, scripts tao PDF/CSV/token |
| Auth/RBAC | login admin/organizer/student/staff, route guards |
| Workshop catalog | Student Web + Admin Web CRUD/publish |
| Registration concurrency | `pnpm demo:race -- --clients=100` |
| Idempotency | `pnpm demo:idempotency -- --attempts=5` |
| Payment + circuit breaker | paid registration + stop/start `mock-pg` |
| Notification | Mailhog + `/notifications/me` |
| Check-in offline | Expo app + SQLite queue + `scripts/demo/offline-checkin.md` |
| AI summary | `scripts/smoke-ai-summary.ps1` + Gemini `READY` + cache hit |
| CSV sync | `scripts/smoke-csv-sync.ps1` |
| Observability | `/health`, `/metrics`, Docker healthchecks |
| Video demo | Quay app/code dang chay, terminal test PASS, camera thanh vien |

## 12. Cleanup

Stop nhung giu data:

```powershell
docker compose --profile all down
```

Stop va xoa Docker named/anonymous volumes:

```powershell
pnpm stack:down
```

Luu y: compose hien mount bind vao `src/data/*`, nen `down -v` khong dam bao
xoa sach cac file runtime trong thu muc nay. Neu can reset DB tuyet doi, dung
mot ban sao/thu muc data moi hoac don `src/data` sau khi da backup bang chung.
