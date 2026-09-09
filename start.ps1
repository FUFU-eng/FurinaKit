# FurinaKit — start everything
$root = $PSScriptRoot

# Terminal 1: Python worker
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\services\worker'; python worker.py"

# Terminal 2: Next.js dev server
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\apps\web'; .\node_modules\.bin\next.cmd dev"

Write-Host "FurinaKit starting..." -ForegroundColor Cyan
Write-Host "  Web  -> http://localhost:3000" -ForegroundColor Green
Write-Host "  Worker -> http://localhost:8000" -ForegroundColor Green
