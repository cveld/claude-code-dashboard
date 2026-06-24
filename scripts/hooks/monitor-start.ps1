param([string]$SessionId)

if (-not $SessionId) { exit 1 }

$sessionsDir = [System.IO.Path]::Combine($env:USERPROFILE, '.claude', 'sessions')
$file  = [System.IO.Path]::Combine($sessionsDir, "$SessionId-inbox.jsonl")
$ready = [System.IO.Path]::Combine($sessionsDir, "$SessionId-monitor.ready")

# If a .ready file exists, check if the stored PID is still alive.
if (Test-Path $ready) {
    $storedPid = (Get-Content $ready -Raw -ErrorAction SilentlyContinue).Trim()
    if ($storedPid -match '^\d+$') {
        $alive = $false
        try { Get-Process -Id ([int]$storedPid) -ErrorAction Stop | Out-Null; $alive = $true } catch {}
        if ($alive) { exit 0 }
    }
    Remove-Item $ready -Force -ErrorAction SilentlyContinue
}

[System.IO.Directory]::CreateDirectory($sessionsDir) | Out-Null
if (-not (Test-Path $file)) { [System.IO.File]::WriteAllText($file, '') }

# Write this process's PID so the dashboard can validate liveness.
[System.IO.File]::WriteAllText($ready, $PID.ToString())

$stream = $null
$reader = $null
try {
    $stream = [System.IO.File]::Open($file, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $reader = New-Object System.IO.StreamReader($stream)
    [void]$stream.Seek(0, [System.IO.SeekOrigin]::End)

    while (Test-Path $ready) {
        $line = $reader.ReadLine()
        if ($line) {
            try {
                $d = $line | ConvertFrom-Json
                if ($d.message) { Write-Output "MSG: $($d.message)" }
                else            { Write-Output "RAW: $line" }
            } catch { Write-Output "RAW: $line" }
        } else {
            Start-Sleep -Milliseconds 200
        }
    }
} finally {
    if ($reader) { $reader.Close() }
    if ($stream) { $stream.Close() }
    Remove-Item $ready -Force -ErrorAction SilentlyContinue
}
