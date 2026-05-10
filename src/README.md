# UniHub Workshop

Hệ thống số hoá toàn bộ vòng đời workshop của Tuần lễ Kỹ năng & Nghề nghiệp.
Đồ án TKPM (HCMUS) — **Phần 1: Blueprint** (xem `blueprint/`) và **Phần 2: Cài đặt** (đang triển khai trong monorepo này).

> Đây là **Phần 2 — Cài đặt**. Phần 1 (Blueprint) nằm ở `../blueprint/` so với thư mục này. Mọi lệnh dưới đây chạy với `cwd = src/`.

## Cấu trúc thư mục `src/`

```
src/
├── apps/
│   ├── backend/           # NestJS modular monolith + workers (Auth, Catalog, Registration, Payment, Notification, Checkin, AI Summary, CSV Sync)
│   ├── student-web/       # Vite + React student portal
│   ├── admin-web/         # Vite + React organizer/sys-admin portal
│   └── mobile/            # Expo React Native (CHECKIN_STAFF, offline SQLite queue)
├── services/
│   ├── mock-pg/           # Mock Payment Gateway (Express) — toggle down/timeout để demo Circuit Breaker
│   └── mock-ai/           # Mock AI summarizer (Express) — toggle down để demo retry/fallback
├── data/                  # Volumes runtime: postgres, redis, rabbitmq, minio, csv-drop/quarantine/archive (gitignored)
├── docker-compose.yml     # Postgres, Redis, RabbitMQ, MinIO, Mailhog + apps + mock services
├── pnpm-workspace.yaml
└── package.json
```

## Yêu cầu

- **Node.js** ≥ 20.10
- **pnpm** ≥ 9 (`corepack enable && corepack prepare pnpm@9.7.0 --activate`)
- **Docker Desktop** (Compose v2)

## Khởi chạy nhanh

```bash
cp .env.example .env
pnpm install

# Hạ tầng (postgres, redis, rabbitmq, minio, mailhog)
pnpm infra:up

# Migrate + seed dữ liệu mẫu
pnpm db:migrate:deploy
pnpm db:seed

# Toàn bộ stack (backend + frontends + mock services)
pnpm stack:up
```

Sau khi `stack:up` xong (< 90 giây trên máy dev điển hình):

| Dịch vụ         | URL                                            |
| --------------- | ---------------------------------------------- |
| Backend API     | http://localhost:3000                          |
| Student Web     | http://localhost:5173                          |
| Admin Web       | http://localhost:5174                          |
| RabbitMQ UI     | http://localhost:15672 (unihub / unihub)       |
| MinIO Console   | http://localhost:9001 (unihub / unihub-secret) |
| Mailhog UI      | http://localhost:8025                          |
| Mock Payment GW | http://localhost:4000                          |
| Mock AI         | http://localhost:4100                          |

Tài khoản bootstrap mặc định:

- `admin@unihub.local` / `Admin@123456` — vai trò `SYS_ADMIN`

Các tài khoản mẫu khác được tạo bởi `pnpm db:seed` (xem `apps/backend/src/seed/seed.ts`).

## Mapping blueprint ↔ code

| Blueprint                                           | Code                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `blueprint/specs/auth.md`                           | `apps/backend/src/modules/auth`                                          |
| `blueprint/specs/workshop-catalog.md`               | `apps/backend/src/modules/catalog`                                       |
| `blueprint/specs/registration.md`                   | `apps/backend/src/modules/registration` + Lua `allocateSeat/releaseSeat` |
| `blueprint/specs/payment.md` + `circuit-breaker.md` | `apps/backend/src/modules/payment` + `services/mock-pg`                  |
| `blueprint/specs/notification.md`                   | `apps/backend/src/modules/notification` (channel adapter)                |
| `blueprint/specs/checkin.md`                        | `apps/backend/src/modules/checkin` + `apps/mobile`                       |
| `blueprint/specs/ai-summary.md`                     | `apps/backend/src/modules/ai-summary` + `services/mock-ai`               |
| `blueprint/specs/csv-sync.md`                       | `apps/backend/src/modules/csv-sync` (cron worker)                        |
| `blueprint/specs/rate-limiting.md`                  | `apps/backend/src/common/rate-limit` (Lua token bucket)                  |
| `blueprint/specs/idempotency.md`                    | `apps/backend/src/common/idempotency`                                    |

## Demo scripts

Phase 8 demo/load scripts are committed under `scripts/demo/` and `scripts/k6/`:

- Race condition: `pnpm demo:race -- --clients=100` creates 100 demo students and proves capacity=1 produces exactly one active registration.
- Payment idempotency: `pnpm demo:idempotency -- --attempts=5` repeats `POST /payments` with one `Idempotency-Key` and verifies exactly one durable payment row.
- Offline check-in runbook: `scripts/demo/offline-checkin.md`.
- k6 registration load: `pnpm demo:k6` with `WORKSHOP_ID` and either `STUDENT_TOKEN` or `TOKENS_FILE`.

## Test runbooks

Detailed test guides for grading/demo are in `docs/`:

- `docs/TESTING_WEB_API.md` - full Docker stack, backend API, Student Web, Admin Web, AI summary, CSV sync.
- `docs/TESTING_MOBILE_EXPO.md` - Expo mobile check-in guide from zero, including physical phone/emulator setup and offline queue scenarios.
- `docs/TESTING_DEMO_SCRIPTS.md` - race condition, idempotency, k6 load, smoke scripts, and evidence checklist.

## Phát triển

```bash
# Chạy backend dev (watch mode)
pnpm --filter ./apps/backend dev

# Chạy student-web dev
pnpm dev:student

# Chạy admin-web dev
pnpm dev:admin

# Chạy mobile check-in app
pnpm --filter ./apps/mobile start

# Lint / format
pnpm lint
pnpm format
```

## Trạng thái triển khai

- [x] **Phase 0** — Foundation (monorepo + docker-compose + Prisma schema)
- [x] **Phase 1** — Auth + RBAC + Rate Limit + Idempotency + Outbox + Catalog
- [x] **Phase 2** — Registration (Lua allocate/release) + Payment + Circuit Breaker + Mock PG
- [x] **Phase 3** — Check-in API (offline-aware idempotent) + Notification adapter
- [x] **Phase 4** — AI summary pipeline (PDF → MinIO → pdfjs → Mock AI → cache theo SHA-256)
- [x] **Phase 5** — CSV sync cron (mssv import + atomic move + quarantine + advisory lock)
- [x] **Phase 6** — Expo mobile (JWKS cache + RS256 offline verify + SQLite WAL queue + NetInfo auto-sync)
- [x] **Phase 7** — Student web + Admin web (Vite/React UI)
- [x] **Phase 8** — Demo scripts (k6 load, race-condition, idempotency, offline check-in runbook)

## Smoke test Phase 4 (AI Summary)

```powershell
# 1. Sinh PDF mẫu (~245 từ tiếng Anh)
node scripts/make-test-pdf.js

# 2. Đảm bảo infra + mock-ai + backend đang chạy:
#    pnpm infra:up
#    pnpm --filter ./services/mock-ai dev      # PORT=4100 (mặc định)
#    pnpm --filter ./apps/backend dev          # PORT=3000

# 3. Chạy smoke test (login organizer → upload PDF → poll READY → cache hit)
powershell -ExecutionPolicy Bypass -File scripts/smoke-ai-summary.ps1
```

Toggle thử AI down: chạy mock-ai với `MOCK_AI_DOWN=true` → backend retry 4 lần
(10s/30s/90s) rồi mark `FAILED`. Bật lại mock-ai bình thường + gọi
`POST /workshops/{id}/summary/retry` để khôi phục.

## Smoke test Phase 5 (CSV sync)

```powershell
# Đảm bảo backend dev :3000 đang chạy (cần SYS_ADMIN admin@unihub.local).
# Cron mặc định 02:00 hằng ngày — endpoint admin trigger thủ công bất cứ lúc nào.
powershell -ExecutionPolicy Bypass -File scripts/smoke-csv-sync.ps1
```

Test bao gồm: 100 dòng valid → `SUCCESS`; re-drop cùng SHA → skip (UNIQUE
`import_jobs.file_sha256`); header sai → `FAILED` + file vào
`csv-quarantine/`; 5 % dòng lỗi → `PARTIAL` với `errorLog.failedRows`.

Sinh CSV thủ công:

```bash
node scripts/make-test-csv.js --rows=10000             # 10K dòng đẹp
node scripts/make-test-csv.js --rows=200 --partial     # 5% dòng sai email
node scripts/make-test-csv.js --bad-header             # header không khớp
```

Folder mặc định (override qua env `CSV_DROP_DIR/CSV_QUARANTINE_DIR/CSV_ARCHIVE_DIR`):

| Vai trò    | Path mặc định                       |
| ---------- | ----------------------------------- |
| Drop       | `apps/backend/data/csv-drop/`       |
| Archive    | `apps/backend/data/csv-archive/`    |
| Quarantine | `apps/backend/data/csv-quarantine/` |

## Smoke test Phase 7 (Web apps)

```bash
# Build frontend production bundles
pnpm build:web

# Chạy local dev từng app
pnpm dev:student
pnpm dev:admin

# Chạy bằng Docker Compose cùng backend + mock services
pnpm web:up
```

Student Web có các luồng chính: login/register, xem danh sách workshop, xem detail + AI summary, đăng ký, thanh toán mock, xem QR token.

Admin Web có các luồng chính: login organizer/sys-admin, CRUD/publish/cancel workshop, upload PDF + retry AI summary, xem registrations/check-ins, quản lý staff assignments và trigger CSV sync.

## Smoke test Phase 6 (Mobile offline check-in)

```powershell
# Terminal 1: backend
pnpm infra:up
pnpm --filter ./apps/backend dev

# Terminal 2: Expo mobile
pnpm --filter ./apps/mobile start
```

Trên thiết bị thật, đặt API URL thành `http://<LAN-IP>:3000` thay vì `localhost`.
Login staff sẽ tự cache `GET /auth/jwks`; sau đó app có thể reject QR sai chữ ký khi offline.

Các luồng cần test:

- Online scan: quét QR hợp lệ → queue → auto-sync → DB có đúng 1 `checkins`.
- Duplicate: quét lại cùng QR → backend trả `duplicate`, app lưu result item-level.
- Offline: bật airplane mode → quét QR → SQLite giữ `synced=false`; bật mạng lại → NetInfo auto-sync.
- Tampered QR: sửa 1 ký tự token → app reject offline, không insert SQLite.
- Pending logout: còn queue chưa sync → app cảnh báo trước khi logout.

Runbook chi tiết: `scripts/demo/offline-checkin.md`.

## Smoke test Phase 8 (Demo/load scripts)

```powershell
# Preconditions: infra + backend are running, apps/backend/.env has stable JWT_PRIVATE_KEY/JWT_PUBLIC_KEY.
pnpm infra:up
pnpm --filter ./apps/backend dev

# Race condition: many clients competing for one seat.
pnpm demo:race -- --clients=100

# Payment idempotency: repeated POST /payments with one key.
# Mock PG must be running for a full success-path demo.
pnpm --filter ./services/mock-pg dev
pnpm demo:idempotency -- --attempts=5
```

k6 load test requires `k6` installed and a prepared workshop/student token pool:

```bash
WORKSHOP_ID=<published-workshop-id> TOKENS_FILE=./tokens.json pnpm demo:k6
```

`scripts/k6/registration-load.js` treats `201`, `202`, `409`, `429`, and deliberate
`503 registration_queue_full` capacity signals as handled outcomes.
When the global registration threshold is exceeded, backend returns `202 QUEUED` with
`processingId`; clients poll `GET /registrations/processing/{processingId}`.

Refund hardening is also active: paid registration/workshop cancellation and late paid
webhooks emit refund work, create `payment_refunds`, call Mock PG `/refund`, and mark
payment `REFUNDED` when the gateway confirms success. If the circuit is open, refund
rows stay `REQUESTED` for the retry job.

Operational metrics are exposed at `GET /metrics` in Prometheus text format, including
`registration_queue_size`, registration totals, check-in count, notification status
counts, payment status counts, and unpublished outbox events.

Manual offline check-in runbook: `scripts/demo/offline-checkin.md`.
