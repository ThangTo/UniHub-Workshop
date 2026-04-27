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
│   └── mobile/            # Expo React Native (CHECKIN_STAFF, offline SQLite)
├── services/
│   ├── mock-pg/           # Mock Payment Gateway (Express) — toggle down/timeout để demo Circuit Breaker
│   └── mock-ai/           # Mock AI summarizer (Express) — toggle down để demo retry/fallback
├── packages/
│   └── shared/            # DTO, schema, types dùng chung BE/FE
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

- `scripts/demo/race-condition.ts` — 1000 client cùng đăng ký 1 ghế cuối, expect duy nhất 1 thắng.
- `scripts/demo/idempotency.ts` — 5 lần POST `/payments` cùng key, expect 1 charge ở Mock PG.
- `scripts/demo/offline-checkin.md` — kịch bản bật airplane mode trên Expo app.
- `scripts/k6/registration-load.js` — 3000 vRPS / 60 giây vào `/registrations`.

## Phát triển

```bash
# Chạy backend dev (watch mode)
pnpm --filter ./apps/backend dev

# Chạy student-web dev
pnpm --filter ./apps/student-web dev

# Lint / format
pnpm lint
pnpm format
```

## Trạng thái triển khai

- [x] **Phase 0** — Foundation (monorepo + docker-compose + Prisma schema)
- [x] **Phase 1** — Auth + RBAC + Rate Limit + Idempotency + Outbox + Catalog
- [x] **Phase 2** — Registration (Lua allocate/release + FCFS queue 202) + Payment + Circuit Breaker + Mock PG
- [x] **Phase 3** — Check-in API (offline-aware idempotent) + Notification adapter
- [x] **Phase 4** — AI summary pipeline (PDF → MinIO → pdfjs → Mock AI → cache theo SHA-256)
- [ ] **Phase 5** — CSV sync cron (mssv import + atomic move + quarantine)
- [ ] **Phase 6** — Expo mobile (offline SQLite check-in)
- [ ] **Phase 7** — Student web + Admin web (Vite/React UI)
- [ ] **Phase 8** — Demo scripts (k6 load, race-condition, idempotency)

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
