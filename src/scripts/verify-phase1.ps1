# Verify Phase 1 — chạy từ thư mục `src/`
# Yêu cầu: Docker Desktop đã chạy, pnpm install đã xong.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

Write-Host "==> 1/5 Khởi động infra (postgres/redis/rabbitmq/minio/mailhog)..." -ForegroundColor Cyan
docker compose up -d postgres redis rabbitmq minio mailhog
if ($LASTEXITCODE -ne 0) { throw "Docker compose failed" }

Write-Host "==> 2/5 Đợi Postgres ready..." -ForegroundColor Cyan
$retries = 30
while ($retries -gt 0) {
  $status = docker exec unihub-postgres pg_isready -U unihub -d unihub 2>$null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
  $retries--
}
if ($retries -eq 0) { throw "Postgres did not become ready in time" }
Write-Host "    ✓ Postgres ready" -ForegroundColor Green

Write-Host "==> 3/5 Prisma migrate dev (init)..." -ForegroundColor Cyan
Push-Location apps\backend
try {
  pnpm exec prisma migrate dev --name init --skip-seed
  if ($LASTEXITCODE -ne 0) { throw "Prisma migrate failed" }
} finally {
  Pop-Location
}

Write-Host "==> 4/5 Seed dev data..." -ForegroundColor Cyan
Push-Location apps\backend
try {
  pnpm seed
  if ($LASTEXITCODE -ne 0) { throw "Seed failed" }
} finally {
  Pop-Location
}

Write-Host "==> 5/5 Khởi động backend (dev mode)..." -ForegroundColor Cyan
Write-Host "Mở terminal mới và chạy: cd apps\backend; pnpm dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "Sau đó test bằng curl:" -ForegroundColor Yellow
Write-Host @'

# Login organizer
curl -X POST http://localhost:3000/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"organizer@unihub.local","password":"Test@12345"}'

# List workshops (public)
curl http://localhost:3000/workshops

# Register sinh viên
curl -X POST http://localhost:3000/auth/register `
  -H "Content-Type: application/json" `
  -d '{"email":"sv1@hcmus.edu.vn","password":"Test@12345","fullName":"Nguyễn Văn A","studentCode":"21120001"}'

# Health check
curl http://localhost:3000/health

'@ -ForegroundColor Gray
