# UniHub Workshop - Huong Dan Test Demo Scripts Va Load

Tai lieu nay dung de tao bang chung cho cac success criteria ve concurrency,
idempotency, offline check-in, AI summary, CSV sync va load test.

## 1. Chay Nhanh Tat Ca Build/Test

Tu thu muc `src`:

```powershell
pnpm build
pnpm lint
pnpm test
docker compose --profile all config --quiet
docker compose --profile all build
```

Expected:

- Build xanh.
- Lint xanh.
- Unit tests xanh.
- Docker config/build xanh.

Neu chay bang Docker full stack, khong can tao `.env` vi `docker-compose.yml`
da co default dev values. Neu chay backend local hoac can JWT key co dinh cho
demo scripts, xem `docs/ENVIRONMENT.md`.

## 2. Smoke Test AI Summary

Start stack:

```powershell
pnpm stack:up
docker compose --profile all exec backend pnpm run seed
```

Chay smoke:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-ai-summary.ps1
```

Expected:

- Upload PDF thanh cong.
- Status tu `PENDING` sang `READY`.
- Summary co noi dung tieng Viet.
- Co 5 highlights.
- Re-upload cung PDF tra cache hit.

Neu mock AI random fail:

- Script co the test retry.
- Hoac chay lai mot lan nua.

## 3. Smoke Test CSV Sync

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-csv-sync.ps1
```

Expected:

- Valid CSV: `SUCCESS`.
- Duplicate SHA: skip.
- Bad header: `FAILED` va move vao quarantine.
- Partial invalid rows: `PARTIAL` va co `errorLog.failedRows`.

## 4. Demo Race Condition: 100/1000 Client Tranh 1 Ghe

Muc tieu: chung minh seat allocation atomic, khong oversell.

Script:

```text
scripts/demo/race-condition.ts
```

Mac dinh chay 100 clients. Co the tang toi 1000.

### 4.1 Yeu cau rieng cua demo scripts

Demo scripts tao token truc tiep bang private key. Vi vay can backend va script
dung chung `JWT_PRIVATE_KEY`.

Khuyen nghi chay demo scripts voi backend local hoac backend Docker co env key co
dinh.

Neu chay local backend:

1. Tao file env:

```powershell
Copy-Item .env.example apps/backend/.env -Force
```

2. Sua `apps/backend/.env` de dung host localhost:

```env
DATABASE_URL=postgresql://unihub:unihub@localhost:5432/unihub?schema=public
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://unihub:unihub@localhost:5672
MINIO_ENDPOINT=localhost
MOCK_PG_URL=http://localhost:4000
MOCK_AI_URL=http://localhost:4100
```

3. Tao RSA key pair va paste vao `.env`:

```powershell
node -e "const {generateKeyPairSync}=require('crypto'); const {privateKey, publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}); console.log('JWT_PRIVATE_KEY=' + JSON.stringify(privateKey.export({type:'pkcs8',format:'pem'}))); console.log('JWT_PUBLIC_KEY=' + JSON.stringify(publicKey.export({type:'spki',format:'pem'})));"
```

4. Start infra + mocks + backend local:

```powershell
pnpm infra:up
pnpm mocks:up
pnpm db:migrate:dev
pnpm db:seed
pnpm dev:backend
```

Chay trong terminal khac:

```powershell
pnpm demo:race
```

Tang client:

```powershell
pnpm --filter ./apps/backend exec node -r ts-node/register/transpile-only ../../scripts/demo/race-condition.ts --clients=1000
```

Expected output:

```text
[race] workshop=... capacity=1
[race] http winners=1 ...
[race] dbActive=1 seatsLeft=0
[race] PASS: concurrent registration did not oversell the final seat.
```

Neu thay winners > 1 hoac dbActive > 1 la fail nghiem trong.

## 5. Demo Idempotency: 5 Lan POST Payment Cung Key

Muc tieu: chung minh double click/retry khong tao double charge.

Chay:

```powershell
pnpm demo:idempotency
```

Hoac:

```powershell
pnpm --filter ./apps/backend exec node -r ts-node/register/transpile-only ../../scripts/demo/idempotency.ts --attempts=5
```

Expected:

```text
[idempotency] dbPaymentsWithKey=1
[idempotency] PASS: repeated POST /payments with one key produced one durable payment record.
```

Neu co nhieu payment row cho cung `Idempotency-Key` la fail.

## 6. K6 Registration Load Test

Script:

```text
scripts/k6/registration-load.js
```

Script theo dung success criteria 12.000 SV / 10 phut:

```text
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

### 6.1 Chuan bi workshop va token

K6 can:

- `WORKSHOP_ID`
- `STUDENT_TOKEN` hoac `TOKENS_FILE`

Cach nhanh de lay token:

1. Tao/dang nhap mot student trong Student Web.
2. Lay token tu DevTools localStorage/session, hoac goi API login.

Vi du goi API login:

```powershell
$loginBody = @{
  email = 'student.demo1@unihub.local'
  password = 'Test@12345'
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/auth/login `
  -ContentType 'application/json' `
  -Body $loginBody

$env:STUDENT_TOKEN = $login.accessToken
```

Lay workshop ID:

```powershell
$ws = Invoke-RestMethod http://localhost:3000/workshops
$env:WORKSHOP_ID = $ws.items[0].id
```

### 6.2 Chay load nhe de demo tren laptop

```powershell
$env:RATE = "50"
$env:DURATION = "30s"
k6 run scripts/k6/registration-load.js
```

Expected:

- Response duoc handle bang status `201`, `202`, `409`, `429` hoac queue full signal.
- Khong co 5xx bat thuong.

### 6.3 Chay muc cao theo success criteria

Chi chay khi may du manh:

```powershell
$env:RATE = "3000"
$env:DURATION = "60s"
$env:PREALLOCATED_VUS = "300"
$env:MAX_VUS = "3000"
k6 run scripts/k6/registration-load.js
```

Expected:

- Backend khong crash.
- Duoi tai cao, he thong tra `202 QUEUED`, `429 rate_limited`, `409 sold_out` thay vi loi bat thuong.
- Metrics `/metrics` co queue/payment/seat signals.

### 6.4 Chay dung kich ban 12.000 sinh vien / 10 phut

Yeu cau de bai:

- 12.000 luot truy cap/dang ky trong 10 phut dau.
- 60% don vao 3 phut dau: 7.200 request / 180s = 40 request/giay.
- 40% con lai trong 7 phut sau: 4.800 request / 420s = 80 request / 7 giay.

Script:

```powershell
pnpm demo:k6:12k
```

Hoac:

```powershell
k6 run scripts/k6/registration-12k-10m.js
```

Bien moi truong bat buoc:

```powershell
$env:WORKSHOP_ID = "<published-workshop-id>"
$env:TOKENS_FILE = ".\tokens.json"
```

Co the dung `STUDENT_TOKEN` de test qua tai API nhanh, nhung khi chi dung 1
token thi do la nhieu request tu cung 1 sinh vien, khong phai bang chung cong
bang giua nhieu sinh vien. De chung minh cong bang, nen dung `TOKENS_FILE` gom
nhieu access token cua cac student khac nhau:

```json
[
  "access-token-student-1",
  "access-token-student-2",
  "access-token-student-3"
]
```

Kich ban k6 se xoay vong token theo virtual user va iteration:

```text
token = tokens[(__ITER + __VU) % tokens.length]
```

Moi request co `Idempotency-Key` rieng:

```text
k6-12k-<VU>-<ITER>-<timestamp>
```

Expected:

- Tong request xap xi 12.000.
- 3 phut dau co khoang 7.200 request.
- 7 phut sau co khoang 4.800 request.
- Cac response duoc xem la he thong xu ly co kiem soat: `201`, `202`, `409`, `429`, hoac `503 registration_queue_full`.
- `202 QUEUED` chung minh backend bao ve luong dang ky bang queue khi qua tai cuc bo.
- `429 rate_limited` chung minh client spam lien tuc bi chan.
- `409 sold_out/already_registered` la conflict nghiep vu hop le, khong phai crash.
- Khong co nhieu loi 5xx bat thuong.

Lenh lay evidence sau khi chay:

```powershell
Invoke-WebRequest http://localhost:3000/metrics -UseBasicParsing
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select status, count(*) from registrations group by status;"
```

## 7. Offline Check-in Demo Script

Tai lieu kich ban:

```text
scripts/demo/offline-checkin.md
```

Doc them huong dan chi tiet Expo:

```text
docs/TESTING_MOBILE_EXPO.md
```

Tom tat:

1. Start stack.
2. Tao student registration confirmed va QR.
3. Start Expo app.
4. Login staff.
5. Tat mang.
6. Scan QR.
7. Bat mang.
8. App sync queue len backend.

Expected:

- Offline scan vao SQLite queue.
- Online lai sync accepted.
- Duplicate scan khong tao row thu hai.

## 8. Metrics Va Evidence Cho Bao Cao

Sau khi chay demo, lay evidence:

```powershell
Invoke-WebRequest http://localhost:3000/metrics -UseBasicParsing
```

Kiem tra DB nhanh:

```powershell
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select status, count(*) from registrations group by status;"
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select status, count(*) from payments group by status;"
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select status, count(*) from import_jobs group by status;"
docker compose --profile all exec postgres psql -U unihub -d unihub -c "select count(*) from checkins;"
```

Nen chup man hinh:

- Student Web registration + QR.
- Admin Web workshop + AI summary.
- Admin Web import jobs.
- Mailhog email.
- Mobile offline queue.
- Terminal `PASS` cua race/idempotency.
- K6 summary.
- Docker `ps` full stack healthy.

## 9. Checklist Theo Yeu Cau De Bai

| Tieu chi | Bang chung |
| --- | --- |
| Co thiet ke blueprint | `blueprint/design.md`, specs, Prisma schema |
| Auth/RBAC | login admin/organizer/student/staff, route guards |
| Workshop catalog | Student Web + Admin Web CRUD/publish |
| Registration race condition | `pnpm demo:race` |
| Idempotency | `pnpm demo:idempotency` |
| Payment + circuit breaker | paid registration + mock-pg health/failure |
| Notification | Mailhog + `/notifications/me` |
| Check-in offline | Expo app + `scripts/demo/offline-checkin.md` |
| AI summary | `scripts/smoke-ai-summary.ps1` |
| CSV sync | `scripts/smoke-csv-sync.ps1` |
| Observability | `/health`, `/metrics`, Docker healthchecks |
| Deployability | `docker compose --profile all up -d --build` |

## 10. Cleanup

Stop nhung giu data:

```powershell
docker compose --profile all down
```

Stop va xoa data:

```powershell
pnpm stack:down
```
