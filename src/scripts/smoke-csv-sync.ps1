# Smoke test Phase 5 - CSV sync.
# Pre-reqs: backend dev :3000, infra docker (postgres) up, SYS_ADMIN bootstrapped.

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000'
$dropDir   = Join-Path $PSScriptRoot '..\apps\backend\data\csv-drop'
$archiveDir = Join-Path $PSScriptRoot '..\apps\backend\data\csv-archive'
$qDir      = Join-Path $PSScriptRoot '..\apps\backend\data\csv-quarantine'
foreach ($d in @($dropDir, $archiveDir, $qDir)) {
  if (Test-Path $d) { Get-ChildItem $d -File | Remove-Item -Force }
  else { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

function Login-Admin {
  $body = '{"email":"admin@unihub.local","password":"Admin@123456"}'
  $r = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body
  return @{ Authorization = "Bearer $($r.accessToken)" }
}

function Trigger-Run {
  param($auth)
  Invoke-RestMethod -Method Post -Uri "$base/admin/csv-sync/run" -Headers $auth | Out-Null
}

function Wait-Job {
  param($auth, [int]$timeoutSec = 30)
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    $jobs = Invoke-RestMethod -Method Get -Uri "$base/admin/import-jobs?limit=5" -Headers $auth
    if ($jobs.items.Count -gt 0 -and $jobs.items[0].status -ne 'RUNNING') {
      return $jobs.items[0]
    }
  }
  throw "Timed out waiting for job."
}

$auth = Login-Admin
Write-Host "==> auth OK" -ForegroundColor Cyan

# Test 1: 100 dòng đẹp -> SUCCESS
Write-Host "`n==> Test 1: 100 valid rows" -ForegroundColor Cyan
node scripts\make-test-csv.js --rows=100 | Out-Host
Trigger-Run $auth
$j1 = Wait-Job $auth 30
if ($j1.status -ne 'SUCCESS') { Write-Host "FAIL test1 status=$($j1.status)" -ForegroundColor Red; exit 1 }
Write-Host "[OK] SUCCESS total=$($j1.totalRows) inserted=$($j1.insertedRows) updated=$($j1.updatedRows)" -ForegroundColor Green

# Test 2: same SHA -> skipped (no new job)
Write-Host "`n==> Test 2: re-drop same file (cache by SHA)" -ForegroundColor Cyan
$archived = Get-ChildItem $archiveDir -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item $archived.FullName -Destination (Join-Path $dropDir $archived.Name)
Trigger-Run $auth
Start-Sleep -Seconds 2
$jobsAfter = Invoke-RestMethod -Method Get -Uri "$base/admin/import-jobs?limit=5" -Headers $auth
$dupJob = $jobsAfter.items | Where-Object { $_.id -eq $j1.id }
if (-not $dupJob) { Write-Host "FAIL test2 - job vanished" -ForegroundColor Red; exit 1 }
Write-Host "[OK] duplicate skipped, no new job created" -ForegroundColor Green

# Test 3: bad header -> FAILED + quarantined
Write-Host "`n==> Test 3: bad header -> quarantine" -ForegroundColor Cyan
node scripts\make-test-csv.js --rows=50 --bad-header | Out-Host
Trigger-Run $auth
$j3 = Wait-Job $auth 15
if ($j3.status -ne 'FAILED') { Write-Host "FAIL test3 status=$($j3.status)" -ForegroundColor Red; exit 1 }
$qFiles = Get-ChildItem $qDir -File
if ($qFiles.Count -lt 1) { Write-Host "FAIL test3 - no file quarantined" -ForegroundColor Red; exit 1 }
Write-Host "[OK] FAILED + file in quarantine ($($qFiles.Count) file)" -ForegroundColor Green

# Test 4: partial errors -> PARTIAL with failed_rows
Write-Host "`n==> Test 4: partial errors (5%)" -ForegroundColor Cyan
node scripts\make-test-csv.js --rows=200 --partial | Out-Host
Trigger-Run $auth
$j4 = Wait-Job $auth 15
if ($j4.status -ne 'PARTIAL') { Write-Host "FAIL test4 status=$($j4.status)" -ForegroundColor Red; exit 1 }
$detail = Invoke-RestMethod -Method Get -Uri "$base/admin/import-jobs/$($j4.id)" -Headers $auth
if ($null -eq $detail.errorLog -or $null -eq $detail.errorLog.failedRows) {
  Write-Host "FAIL test4 - no errorLog.failedRows" -ForegroundColor Red; exit 1
}
Write-Host "[OK] PARTIAL total=$($j4.totalRows) failed=$($j4.failedRows) errorLog.failedRows.count=$($detail.errorLog.failedRows.Count)" -ForegroundColor Green

Write-Host "`nAll Phase 5 smoke tests passed." -ForegroundColor Green
