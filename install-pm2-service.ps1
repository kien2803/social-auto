# Run this script once in PowerShell as Administrator to install PM2 as a
# Windows Service. After install, PM2 runs without any console window and
# auto-starts on boot. No more popup terminals.
#
# To run:
#   1. Open PowerShell as Administrator (Win+X -> Terminal (Admin))
#   2. cd C:\Users\ASUSZenbook\Documents\Code\social-auto
#   3. Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   4. .\install-pm2-service.ps1
#
# After install, you can manage PM2 normally from any terminal:
#   pm2 list
#   pm2 restart all
#   pm2 save
#   pm2 logs
#
# To uninstall later:
#   pm2-service-uninstall
#   npm uninstall -g pm2-windows-service

$ErrorActionPreference = 'Stop'

# Locate the repo root and the ecosystem file the service should launch.
$repoRoot  = (Resolve-Path -Path (Join-Path $PSScriptRoot '.')).Path
$ecosystem = Join-Path $repoRoot 'ecosystem.config.cjs'

if (-not (Test-Path -LiteralPath $ecosystem)) {
  throw "[install] ecosystem config not found at $ecosystem"
}

# 1. Install pm2-windows-service globally (provides the service wrapper).
#    NOTE: pm2-windows-service is the supported wrapper for PM2 on Windows.
#    `pm2-service-install` accepts ONLY `-n <name>` and `--unattended`;
#    `--pm2` and `--node` flags are NOT supported and were removed (INFRA-010).
Write-Host "Installing pm2-windows-service..." -ForegroundColor Cyan
npm install -g pm2-windows-service

# 2. Tell the PM2 service which scripts to launch on start. Setting
#    PM2_SERVICE_SCRIPTS lets the service run the configured ecosystem
#    directly on boot, instead of relying on `pm2 resurrect` to find a
#    dump file that may not exist on a fresh install (INFRA-009).
Write-Host "Wiring PM2_SERVICE_SCRIPTS for the installed service..." -ForegroundColor Cyan
[System.Environment]::SetEnvironmentVariable(
  'PM2_SERVICE_SCRIPTS',
  $ecosystem,
  [System.EnvironmentVariableTarget]::Machine
)
$env:PM2_SERVICE_SCRIPTS = $ecosystem

# 3. Install PM2 as a Windows Service named "PM2". The service reads
#    PM2_HOME and PM2_SERVICE_SCRIPTS from the machine environment, so
#    set both before invoking the installer.
Write-Host "Installing PM2 service..." -ForegroundColor Cyan
[System.Environment]::SetEnvironmentVariable(
  'PM2_HOME',
  "$env:USERPROFILE\.pm2",
  [System.EnvironmentVariableTarget]::Machine
)
$env:PM2_HOME = "$env:USERPROFILE\.pm2"

pm2-service-install -n PM2 --unattended

# 4. Start the service if not already running.
$svc = Get-Service PM2 -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Running') {
  Write-Host "Starting PM2 service..." -ForegroundColor Cyan
  Start-Service PM2
}

# 5. Install pm2-logrotate via PM2's module installer (NOT `npm install`).
#    This keeps a single log file per app, rotates at a sensible size, and
#    compresses rotated logs so the disk doesn't fill up over time (INFRA-009).
Write-Host "Installing pm2-logrotate module..." -ForegroundColor Cyan
& "$env:USERPROFILE\AppData\Roaming\npm\pm2.cmd" install pm2-logrotate

Write-Host ""
Write-Host "Done. PM2 now runs as a Windows Service." -ForegroundColor Green
Write-Host "Verify: Get-Service PM2 ; pm2 list ; pm2 logs" -ForegroundColor Green
