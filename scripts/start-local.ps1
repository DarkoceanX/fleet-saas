$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath 'apps\api\dist\main.js') -or -not (Test-Path -LiteralPath 'apps\web\.next\BUILD_ID')) { throw 'Сначала выполните npm run build.' }
& (Join-Path $PSScriptRoot 'setup-local.ps1')
$pidFile = Join-Path $projectRoot 'work\app-processes.json'
if (Test-Path -LiteralPath $pidFile) {
 $prior = Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json
 foreach ($entry in $prior) { $p = Get-Process -Id $entry.id -ErrorAction SilentlyContinue; if ($p -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.startedTicks) { throw 'Приложение уже запущено. Сначала scripts/stop-local.ps1.' } }
}
foreach ($port in @(3000,4000)) {
 $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
 try { $listener.Start() } catch { throw "Порт $port уже занят. Освободите его перед запуском Fleet." } finally { $listener.Stop() }
}
$env:NEXT_TELEMETRY_DISABLED = '1'
$node = (Get-Command node.exe).Source
$api = Start-Process -FilePath $node -ArgumentList 'apps/api/dist/main.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput 'work\api.log' -RedirectStandardError 'work\api-error.log'
$web = Start-Process -FilePath $node -ArgumentList 'node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3000' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput 'work\web.log' -RedirectStandardError 'work\web-error.log'
@($api,$web) | ForEach-Object { @{id=$_.Id;startedTicks=$_.StartTime.ToUniversalTime().Ticks.ToString()} } | ConvertTo-Json | Set-Content -LiteralPath $pidFile
$ready = $false
for ($attempt=0; $attempt -lt 30; $attempt++) {
 try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/v1/health' -TimeoutSec 2 -NoProxy
  $page = Invoke-WebRequest -Uri 'http://127.0.0.1:3000' -TimeoutSec 2 -NoProxy
  if ($health.status -eq 'ok' -and $page.StatusCode -eq 200) { $ready=$true; break }
 } catch { Start-Sleep -Milliseconds 300 }
}
if (-not $ready) { foreach ($p in @($api,$web)) { if (-not $p.HasExited) { Stop-Process -InputObject $p } }; throw 'Приложение не ответило. См. work/api-error.log и work/web-error.log.' }
Write-Host 'Fleet SaaS: http://localhost:3000. Логи: work/. Остановка: ./scripts/stop-local.ps1'
