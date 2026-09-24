# Windows Task Scheduler Setup for Database Backup
# 
# This script creates a Windows Task Scheduler job to run database backups automatically.
# 
# Usage:
#   .\scripts\setup-backup-task.ps1
# 
# The task will run once per day at 2 AM by default.

param(
    [string]$ScheduleTime = "02:00",  # Default: 2 AM
    [switch]$Remove                  # Remove the task instead of creating
)

$TaskName = "SocialAuto-Database-Backup"
$ScriptPath = Join-Path $PSScriptRoot "backup-db.ps1"
$WorkingDirectory = Split-Path -Parent (Split-Path -Parent $ScriptPath)

if ($Remove) {
    Write-Host "Removing scheduled task: $TaskName" -ForegroundColor Yellow
    
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
        Write-Host "✅ Task removed successfully" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Task not found or error removing: $_" -ForegroundColor Yellow
    }
    
    exit 0
}

Write-Host "Setting up scheduled task: $TaskName" -ForegroundColor Cyan
Write-Host "Schedule: Daily at $ScheduleTime" -ForegroundColor Cyan
Write-Host "Script: $ScriptPath" -ForegroundColor Cyan
Write-Host "Working directory: $WorkingDirectory" -ForegroundColor Cyan

# Check if script exists
if (-not (Test-Path $ScriptPath)) {
    Write-Error "❌ Backup script not found: $ScriptPath"
    exit 1
}

# Create PowerShell action with execution policy bypass
$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory $WorkingDirectory

# Create daily trigger
$Trigger = New-ScheduledTaskTrigger -Daily -At $ScheduleTime

# Task settings
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

# Principal (run as current user with highest privileges)
$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

# Register the task
try {
    # Remove existing task if it exists
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Write-Host "Removing existing task..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    
    # Register new task
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal `
        -Description "Daily automated backup for social-auto database" `
        -ErrorAction Stop
    
    Write-Host "✅ Scheduled task created successfully" -ForegroundColor Green
    Write-Host ""
    Write-Host "Task details:" -ForegroundColor Cyan
    $task = Get-ScheduledTask -TaskName $TaskName
    Write-Host "  Name: $($task.TaskName)" -ForegroundColor White
    Write-Host "  Schedule: $($task.Triggers.Frequency) at $($task.Triggers.StartBoundary)" -ForegroundColor White
    Write-Host "  Script: $ScriptPath" -ForegroundColor White
    Write-Host "  Next run: $($task.NextRunTime)" -ForegroundColor White
    Write-Host ""
    Write-Host "To test the backup immediately, run:" -ForegroundColor Yellow
    Write-Host "  .\scripts\backup-db.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "To view task history:" -ForegroundColor Yellow
    Write-Host "  Get-ScheduledTaskInfo -TaskName `"$TaskName`"" -ForegroundColor White
    Write-Host ""
    Write-Host "To remove the task:" -ForegroundColor Yellow
    Write-Host "  .\scripts\setup-backup-task.ps1 -Remove" -ForegroundColor White
    
} catch {
    Write-Error "❌ Failed to create scheduled task: $_"
    exit 1
}
