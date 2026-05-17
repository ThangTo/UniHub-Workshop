# UniHub Workshop - Huong Dan Test Web Va API

Tai lieu nay dung de test cac luong chinh cua do an tren Docker full stack:
backend, database, Redis, RabbitMQ, MinIO, Mailhog, mock payment gateway,
Student Web va Admin Web. AI Summary hien goi Gemini API that qua
`GEMINI_API_KEY`; `services/mock-ai` chi con la legacy service.

## 1. Yeu Cau Truoc Khi Chay

Can cai san:

- Docker Desktop
- Node.js 20+
- pnpm 9+
- Git

Kiem tra nhanh:

```powershell
node -v
pnpm -v
docker version
docker compose version
```

Di chuyen vao workspace source:

```powershell
cd <repo>\src
```

## 1.1 Co Can Tao `.env` Khong?

Neu chay full stack bang Docker, ban khong bat buoc tao `.env`. File
`docker-compose.yml` da co default dev values cho DB, Redis, RabbitMQ, MinIO,
Mailhog SMTP va mock payment gateway.

Rieng AI Summary can `GEMINI_API_KEY` hop le. Neu chay Docker Compose va can
test upload PDF -> summary, copy root `.env.example` thanh `src/.env` va dien
key truoc khi start/recreate backend:

Muon xem/toy bien env thi copy:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Neu chay backend local ngoai Docker, tao file `apps/backend/.env` tu:

```powershell
if (!(Test-Path apps/backend/.env)) { Copy-Item apps/backend/.env.example apps/backend/.env }
```

Chi tiet tung bien nam o `docs/ENVIRONMENT.md`.

## 2. Start Full Stack Bang Docker

Lan dau chay se hoi lau vi Docker phai pull image infra.

```powershell
pnpm stack:up
```

Lenh nay tuong duong:

```powershell
docker compose --profile all up -d --build
```

Kiem tra trang thai:

```powershell
docker compose --profile all ps
```

Expected:

- `unihub-postgres`: healthy
- `unihub-redis`: healthy
- `unihub-rabbitmq`: healthy
- `unihub-minio`: healthy
- `unihub-backend`: healthy
- `unihub-student-web`: up
- `unihub-admin-web`: up
- `unihub-mock-pg`: up
- `unihub-mailhog`: up

Luu y: `unihub-mock-ai` khong nam trong `--profile all`. Neu can chay legacy
mock service rieng thi dung `pnpm mocks:up`, nhung code AI Summary hien tai
khong goi service nay.

Kiem tra backend:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected:

```json
{
  "status": "ok"
}
```

Mo cac UI:

- Student Web: http://localhost:5173
- Admin Web: http://localhost:5174
- Mailhog UI: http://localhost:8025
- RabbitMQ UI: http://localhost:15672
- MinIO Console: http://localhost:9001

Mac dinh RabbitMQ:

- Username: `unihub`
- Password: `unihub`

Mac dinh MinIO:

- Username: `unihub`
- Password: `unihub-secret`

## 3. Seed Du Lieu Demo

Sau khi stack da healthy, seed du lieu:

```powershell
docker compose --profile all exec backend pnpm run seed
```

Tai khoan demo:

| Vai tro | Email | Password |
| --- | --- | --- |
| SYS_ADMIN | `admin@unihub.local` | `Admin@123456` |
| ORGANIZER | `organizer@unihub.local` | `Test@12345` |
| CHECKIN_STAFF | `staff@unihub.local` | `Test@12345` |

MSSV co san de sinh vien dang ky tai khoan:

- `21120001`
- `21120002`
- `21120004`
- `21120005`
- `21120006`
- `22120004`
- `22120005`

Neu MSSV bao da lien ket voi tai khoan khac, dung MSSV khac la nhanh nhat. Neu
can reset database sach, dung data folder moi hoac don `src/data` sau khi da
backup bang chung can nop, roi start va seed lai:

```powershell
pnpm stack:down
pnpm stack:up
docker compose --profile all exec backend pnpm run seed
```

## 4. Test Student Web

Mo:

```text
http://localhost:5173
```

### 4.1 Dang ky tai khoan student

1. Vao Student Web.
2. Chon Register.
3. Nhap:
   - Email: `student.demo1@unihub.local`
   - Password: `Test@12345`
   - Full name: `Student Demo 1`
   - MSSV: mot MSSV trong danh sach seed, vi du `21120004`
4. Submit.

Expected:

- Dang ky thanh cong neu MSSV ton tai trong he thong.
- Neu MSSV khong ton tai, backend tra loi: `MSSV khong co trong he thong...`
  Day la dung yeu cau vi student phai nam trong danh sach CSV/Phong dao tao.

### 4.2 Login student

Dang nhap bang email/password vua tao.

Expected:

- Login thanh cong.
- Khong con loi `Cannot read properties of undefined (reading 'roles')`.

### 4.3 Xem danh sach workshop

1. Vao trang Workshops.
2. Mo mot workshop `PUBLISHED`.

Expected:

- Thay title, time, capacity, fee.
- Neu workshop da upload PDF va AI summary READY, thay summary/highlights.

### 4.4 Dang ky workshop mien phi

1. Chon workshop co fee = 0.
2. Bam Register.
3. Vao My Registrations.

Expected:

- Status thanh `CONFIRMED`.
- Co QR token/QR view de check-in.

### 4.5 Dang ky workshop co phi va thanh toan

1. Chon workshop co fee > 0.
2. Bam Register.
3. Status ban dau la `PENDING_PAYMENT`.
4. Chon thanh toan.

Expected:

- Backend goi mock payment gateway.
- Neu success, registration thanh `CONFIRMED`.
- Co QR token/QR view.
- Mailhog co email thong bao payment/registration.

Kiem tra Mailhog:

```text
http://localhost:8025
```

## 5. Test Admin Web

Mo:

```text
http://localhost:5174
```

Dang nhap bang:

```text
admin@unihub.local / Admin@123456
```

Hoac organizer:

```text
organizer@unihub.local / Test@12345
```

### 5.1 Quan ly workshop

1. Vao Workshops.
2. Tao workshop moi:
   - Title: `Demo Workshop`
   - Description: noi dung bat ky
   - Capacity: `20`
   - Fee: `0` hoac `50000`
   - Start/end trong tuong lai
3. Save.
4. Publish workshop.

Expected:

- Workshop tao thanh cong.
- Publish thanh cong.
- Student Web thay workshop moi.

### 5.2 Upload PDF va AI Summary

1. Vao detail workshop.
2. Upload file PDF hop le.
3. Cho status tu `PENDING` sang `READY`.

Co the dung file test co san:

```text
src/scripts/test-workshop.pdf
```

Expected:

- Upload tra `PENDING` hoac `READY` neu cache hit.
- Worker doc PDF tu MinIO.
- Gemini sinh summary tieng Viet va 5 highlights.
- Re-upload cung PDF tra `cacheHit=true`.

Neu AI fail do thieu/sai key, quota hoac loi mang, sua `GEMINI_API_KEY`, restart
backend, roi bam Retry Summary:

```powershell
docker compose --profile all up -d --force-recreate backend
```

### 5.3 Staff assignments

1. Vao Staff Assignments.
2. Tao assignment cho staff va workshop/room.
3. Xoa assignment.

Expected:

- UI dung contract composite key `staffId + workshopId`.
- Khong con loi `undefined` voi nested staff/workshop/room.

### 5.4 CSV Sync

1. Vao Import Jobs.
2. Bam Run CSV Sync.
3. Xem danh sach jobs.

Co the drop CSV bang script:

```powershell
node scripts/make-test-csv.js --rows=100
```

Sau do trong Admin Web bam Run CSV Sync.

Expected:

- File valid: `SUCCESS`.
- File loi mot phan: `PARTIAL`.
- Bad header: `FAILED` va file vao `data/csv-quarantine`.

## 6. Test API Bang Curl/PowerShell

### 6.1 Health

```powershell
Invoke-RestMethod http://localhost:3000/health
```

### 6.2 Metrics

```powershell
Invoke-WebRequest http://localhost:3000/metrics -UseBasicParsing
```

Expected:

- Co Prometheus metrics.
- Co metrics cho seats/payment/queue/import jobs neu da co data.

### 6.3 Login admin

```powershell
$body = @{
  email = 'admin@unihub.local'
  password = 'Admin@123456'
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/auth/login `
  -ContentType 'application/json' `
  -Body $body

$login.roles
```

Expected:

```text
SYS_ADMIN
```

## 7. Test Build/Lint/Test

Chay truoc khi nop:

```powershell
pnpm build
pnpm lint
pnpm test
docker compose --profile all config --quiet
docker compose --profile all build
```

Expected:

- Build xanh cho backend, mobile, student-web, admin-web, mock-ai, mock-pg.
- Lint TypeScript xanh.
- Unit tests xanh. Hien tai `pnpm test` chay Vitest o backend.
- Docker build xanh.

## 8. Stop Stack

Stop nhung giu data:

```powershell
docker compose --profile all down
```

Stop va xoa Docker named/anonymous volumes:

```powershell
pnpm stack:down
```

Luu y: compose dang bind mount `src/data/*`, nen `stack:down` khong dam bao
xoa sach cac file runtime trong thu muc nay. Neu can reset DB sach, dung data
folder moi hoac don `src/data` sau khi da backup bang chung can nop.
