$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pgBin = Join-Path $projectRoot 'work\pgsql\bin'
$pgData = Join-Path $projectRoot 'work\pgdata'
if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'pg_ctl.exe'))) { throw 'Распакуйте PostgreSQL binaries в work\pgsql (см. docs/RUNBOOK.md).' }
if (-not (Test-Path -LiteralPath '.env')) {
  $dbPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
  $sessionSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  @"
APP_ENV=development
APP_BASE_URL=http://localhost:3000
API_BASE_URL=http://127.0.0.1:4000
API_PORT=4000
DATABASE_URL=postgresql://fleet_local:${dbPassword}@127.0.0.1:55432/fleet_saas
SESSION_SECRET=$sessionSecret
DEMO_PASSWORD=FleetDemo2026!
NEXT_TELEMETRY_DISABLED=1
DISPLAY_TIMEZONE=Europe/Moscow
"@ | Set-Content -LiteralPath '.env' -Encoding utf8
}
$dbLine = Get-Content -LiteralPath '.env' | Where-Object { $_ -like 'DATABASE_URL=*' }
$dbUri = [uri]$dbLine.Substring('DATABASE_URL='.Length)
if ($dbUri.Host -ne '127.0.0.1' -or $dbUri.Port -ne 55432 -or $dbUri.AbsolutePath -ne '/fleet_saas' -or ($dbUri.UserInfo -split ':',2)[0] -ne 'fleet_local') {
 throw 'setup-local поддерживает только свою локальную БД fleet_local@127.0.0.1:55432/fleet_saas. Для внешней БД используйте db:migrate вручную.'
}
$dbPassword = ($dbUri.UserInfo -split ':',2)[1]
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  $pwFile = Join-Path $projectRoot 'work\init-password.tmp'
  try {
    Set-Content -LiteralPath $pwFile -Value $dbPassword -Encoding ascii
    & (Join-Path $pgBin 'initdb.exe') -D $pgData -U fleet_local --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile=$pwFile
    if ($LASTEXITCODE -ne 0) { throw 'initdb завершился с ошибкой' }
    Add-Content -LiteralPath (Join-Path $pgData 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = 55432`ntimezone = 'UTC'"
  } finally { if (Test-Path -LiteralPath $pwFile) { Remove-Item -LiteralPath $pwFile } }
}
& (Join-Path $pgBin 'pg_ctl.exe') -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $pgBin 'pg_ctl.exe') -D $pgData -l (Join-Path $projectRoot 'work\postgres.log') start -w
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL не запустился' }
}
$priorPgPassword = $env:PGPASSWORD
$env:PGPASSWORD = $dbPassword
try {
 $exists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55432 -U fleet_local -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='fleet_saas'"
 if ($exists -ne '1') { & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U fleet_local fleet_saas; if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать базу' } }
} finally { if ($null -eq $priorPgPassword) { Remove-Item Env:\PGPASSWORD } else { $env:PGPASSWORD = $priorPgPassword } }
Write-Host 'PostgreSQL готов: 127.0.0.1:55432. Настройки сохранены в .env.'
