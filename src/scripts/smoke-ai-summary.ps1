# Smoke test - Phase 4 AI Summary
# Pre-reqs: infra docker compose up; mock-ai on :4100; backend on :3000;
#           PDF mau: scripts/test-workshop.pdf (run: node scripts/make-test-pdf.js).

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000'
$pdfPath = Join-Path $PSScriptRoot 'test-workshop.pdf'
if (!(Test-Path $pdfPath)) {
  throw "Missing PDF: $pdfPath. Run: node scripts/make-test-pdf.js"
}

Write-Host "==> 1. Login organizer" -ForegroundColor Cyan
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' `
  -Body '{"email":"organizer@unihub.local","password":"Test@12345"}'
$token = $login.accessToken
Write-Host ("    token=" + $token.Substring(0,40) + "...") -ForegroundColor Gray

Write-Host "==> 2. Pick a workshop" -ForegroundColor Cyan
$auth = @{ Authorization = "Bearer $token" }
$wsList = Invoke-RestMethod -Method Get -Uri "$base/workshops" -Headers $auth
if ($wsList.items.Count -eq 0) { throw "No workshops to test." }
$ws = $wsList.items | Select-Object -First 1
Write-Host ("    workshop=" + $ws.id + " - " + $ws.title) -ForegroundColor Gray

Write-Host "==> 3. Upload PDF (multipart)" -ForegroundColor Cyan
$resp = curl.exe -s -X POST "$base/workshops/$($ws.id)/pdf" `
  -H "Authorization: Bearer $token" `
  -F "file=@$pdfPath;type=application/pdf"
Write-Host ("    upload response: " + $resp) -ForegroundColor Gray
$uploadJson = $resp | ConvertFrom-Json
$sha = $uploadJson.sha256
Write-Host ("    sha256=" + $sha.Substring(0,16) + "... cacheHit=" + $uploadJson.cacheHit + " status=" + $uploadJson.summaryStatus) -ForegroundColor Gray

Write-Host "==> 4. Poll /workshops/{id}/summary every 3s (max 90s)" -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(90)
$final = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  $st = Invoke-RestMethod -Method Get -Uri "$base/workshops/$($ws.id)/summary" -Headers $auth
  Write-Host ("    status=" + $st.summaryStatus) -ForegroundColor DarkGray
  if ($st.summaryStatus -eq 'READY' -or $st.summaryStatus -eq 'FAILED') {
    $final = $st
    break
  }
}
if (-not $final) { throw "Timed out waiting for summary." }

Write-Host ""
if ($final.summaryStatus -eq 'READY') {
  $words = ($final.summary -split '\s+').Count
  Write-Host ("[OK] READY - summary length=" + $words + " words") -ForegroundColor Green
  Write-Host "Summary preview:" -ForegroundColor Yellow
  $preview = $final.summary
  if ($preview.Length -gt 300) { $preview = $preview.Substring(0, 300) + "..." }
  Write-Host $preview -ForegroundColor Gray
  Write-Host "Highlights:" -ForegroundColor Yellow
  $final.summaryHighlights | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Gray }
} else {
  Write-Host ("[FAIL] " + ($final.summaryHighlights | ConvertTo-Json -Compress)) -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "==> 5. Re-upload same PDF -> expect cacheHit=true, READY immediately" -ForegroundColor Cyan
$resp2 = curl.exe -s -X POST "$base/workshops/$($ws.id)/pdf" `
  -H "Authorization: Bearer $token" `
  -F "file=@$pdfPath;type=application/pdf"
$j2 = $resp2 | ConvertFrom-Json
if ($j2.cacheHit -and $j2.summaryStatus -eq 'READY') {
  Write-Host ("[OK] Cache hit - sha=" + $j2.sha256.Substring(0,16) + "...") -ForegroundColor Green
} else {
  Write-Host ("[FAIL] Cache miss unexpected: " + $resp2) -ForegroundColor Red
  exit 1
}
