$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pidFile = Join-Path $projectRoot 'work\app-processes.json'
if (Test-Path -LiteralPath $pidFile) {
 foreach ($entry in (Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json)) {
  $p = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
  if ($p -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.startedTicks) { Stop-Process -InputObject $p }
 }
 Remove-Item -LiteralPath $pidFile
}
$pgCtl = Join-Path $projectRoot 'work\pgsql\bin\pg_ctl.exe'
$pgData = Join-Path $projectRoot 'work\pgdata'
if (Test-Path -LiteralPath $pgCtl) { & $pgCtl -D $pgData status *> $null; if ($LASTEXITCODE -eq 0) { & $pgCtl -D $pgData stop -m fast -w } }
Write-Host 'Локальные процессы Fleet остановлены. Данные сохранены.'
