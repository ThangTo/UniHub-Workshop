# Smoke test Phase 5 - CSV sync.
# Pre-reqs: backend dev :3000, infra docker (postgres) up, SYS_ADMIN bootstrapped.

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000'
$dataRoot = if ($env:UNIHUB_CSV_DATA_ROOT) {
  $env:UNIHUB_CSV_DATA_ROOT
} else {
  Join-Path $PSScriptRoot '..\data'
}
$dropDir   = Join-Path $dataRoot 'csv-drop'
$archiveDir = Join-Path $dataRoot 'csv-archive'
$qDir      = Join-Path $dataRoot 'csv-quarantine'
foreach ($d in @($dropDir, $archiveDir, $qDir)) {
  if (Test-Path $d) { Get-ChildItem $d -File | Remove-Item -Force }
  else { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}
Write-Host "==> CSV data root: $dataRoot" -ForegroundColor DarkGray

function Login-Admin {
  $body = '{"email":"admin@unihub.local","password":"Admin@123456"}'
  $r = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body
  return @{ Authorization = "Bearer $($r.accessToken)" }
}

function Trigger-Run {
  param($auth)
  Invoke-RestMethod -Method Post -Uri "$base/admin/csv-sync/run" -Headers $auth | Out-Null
}

function New-CsvPath {
  # Keep filename compatible with backend parser: students_YYYYMMDD_HHMMSS.csv.
  # Add a small sequence offset so multiple test files in one run do not collide.
  if ($null -eq $script:CsvSeq) { $script:CsvSeq = 0 }
  $script:CsvSeq += 1
  $stamp = (Get-Date).AddSeconds($script:CsvSeq).ToString('yyyyMMdd_HHmmss')
  return Join-Path $dropDir "students_$stamp.csv"
}

function Wait-Job {
  param($auth, [string]$fileName, [int]$timeoutSec = 30)
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    $jobs = Invoke-RestMethod -Method Get -Uri "$base/admin/import-jobs?limit=20" -Headers $auth
    $job = $jobs.items | Where-Object { $_.fileName -eq $fileName } | Select-Object -First 1
    if ($null -ne $job -and $job.status -ne 'RUNNING') {
      return $job
    }
  }
  throw "Timed out waiting for job fileName=$fileName. Check CSV_DROP_DIR/UNIHUB_CSV_DATA_ROOT."
}

$auth = Login-Admin
Write-Host "==> auth OK" -ForegroundColor Cyan

# Test 1: 100 dòng đẹp -> SUCCESS
Write-Host "`n==> Test 1: 100 valid rows" -ForegroundColor Cyan
$csv1 = New-CsvPath
node scripts\make-test-csv.js --rows=100 "--out=$csv1" | Out-Host
Trigger-Run $auth
$j1 = Wait-Job $auth (Split-Path $csv1 -Leaf) 30
if ($j1.status -ne 'SUCCESS') { Write-Host "FAIL test1 status=$($j1.status)" -ForegroundColor Red; exit 1 }
Write-Host "[OK] SUCCESS total=$($j1.totalRows) inserted=$($j1.insertedRows) updated=$($j1.updatedRows)" -ForegroundColor Green

# Test 2: same SHA -> skipped (no new job)
Write-Host "`n==> Test 2: re-drop same file (cache by SHA)" -ForegroundColor Cyan
$archived = Get-ChildItem $archiveDir -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item $archived.FullName -Destination (Join-Path $dropDir $archived.Name)
Trigger-Run $auth
Start-Sleep -Seconds 2
$jobsAfter = Invoke-RestMethod -Method Get -Uri "$base/admin/import-jobs?limit=20" -Headers $auth
$newDupJob = $jobsAfter.items | Where-Object { $_.fileName -eq $archived.Name -and $_.id -ne $j1.id }
if ($newDupJob) { Write-Host "FAIL test2 - duplicate created new job id=$($newDupJob.id)" -ForegroundColor Red; exit 1 }
Write-Host "[OK] duplicate skipped, no new job created" -ForegroundColor Green

# Test 3: bad header -> FAILED + quarantined
Write-Host "`n==> Test 3: bad header -> quarantine" -ForegroundColor Cyan
$csv3 = New-CsvPath
node scripts\make-test-csv.js --rows=50 --bad-header "--out=$csv3" | Out-Host
Trigger-Run $auth
$j3 = Wait-Job $auth (Split-Path $csv3 -Leaf) 15
if ($j3.status -ne 'FAILED') { Write-Host "FAIL test3 status=$($j3.status)" -ForegroundColor Red; exit 1 }
$qFiles = Get-ChildItem $qDir -File
if ($qFiles.Count -lt 1) { Write-Host "FAIL test3 - no file quarantined" -ForegroundColor Red; exit 1 }
Write-Host "[OK] FAILED + file in quarantine ($($qFiles.Count) file)" -ForegroundColor Green

# Test 4: partial errors -> PARTIAL with failed_rows
Write-Host "`n==> Test 4: partial errors (5%)" -ForegroundColor Cyan
$csv4 = New-CsvPath
node scripts\make-test-csv.js --rows=200 --partial "--out=$csv4" | Out-Host
Trigger-Run $auth
$j4 = Wait-Job $auth (Split-Path $csv4 -Leaf) 15
if ($j4.status -ne 'PARTIAL') { Write-Host "FAIL test4 status=$($j4.status)" -ForegroundColor Red; exit 1 }
$detail = Invoke-RestMethod -Method Get -Uri "$base/admin/import-jobs/$($j4.id)" -Headers $auth
if ($null -eq $detail.errorLog -or $null -eq $detail.errorLog.failedRows) {
  Write-Host "FAIL test4 - no errorLog.failedRows" -ForegroundColor Red; exit 1
}
Write-Host "[OK] PARTIAL total=$($j4.totalRows) failed=$($j4.failedRows) errorLog.failedRows.count=$($detail.errorLog.failedRows.Count)" -ForegroundColor Green

Write-Host "`nAll Phase 5 smoke tests passed." -ForegroundColor Green
