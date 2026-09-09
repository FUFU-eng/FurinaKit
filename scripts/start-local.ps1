# FurinaKit local startup (Windows, no Docker)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Set-Location $Root

Write-Host "FurinaKit local setup" -ForegroundColor Cyan
Write-Host "Using file-based job queue (Redis not required)." -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path "$Root\node_modules")) {
    Write-Host "Installing Node dependencies..." -ForegroundColor Cyan
    npx pnpm@9.15.4 install
}

$venvPython = "$Root\services\worker\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
    Set-Location "$Root\services\worker"
    python -m venv .venv
    & .\.venv\Scripts\pip.exe install -r requirements.txt
    Set-Location $Root
}

New-Item -ItemType Directory -Force -Path "$Root\data\storage\uploads", "$Root\data\storage\results", "$Root\data\storage\jobs", "$Root\data\storage\queue" | Out-Null

Write-Host "Starting Python worker in a new window..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root\services\worker'; `$env:USE_FILE_QUEUE='true'; .\.venv\Scripts\python.exe worker.py"

Write-Host ""
Write-Host "Starting FurinaKit web app at http://localhost:3000" -ForegroundColor Green
Write-Host ""

Set-Location $Root
$env:USE_FILE_QUEUE = "true"
npx pnpm@9.15.4 dev
