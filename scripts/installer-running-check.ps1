param([Parameter(Mandatory=$true)][string]$Executable, [switch]$StopRunning)
$ErrorActionPreference = 'Stop'
try {
    $expected = [System.IO.Path]::GetFullPath($Executable)
    $running = @(Get-CimInstance Win32_Process -Filter "Name='FurinaKit.exe'" | Where-Object {
        $_.ExecutablePath -and [String]::Equals($_.ExecutablePath, $expected, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($StopRunning) {
        foreach ($item in $running) { Stop-Process -Id $item.ProcessId -ErrorAction Stop }
    } elseif ($running.Count -gt 0) { exit 10 }
    exit 0
} catch { exit 20 }
