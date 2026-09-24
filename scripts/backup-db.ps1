# Database Backup Script for social-auto (Windows PowerShell)
# 
# Creates automated backups of the SQLite database with:
# - Daily scheduled backups
# - Retention policy (configurable, default 7 days)
# - Off-site storage support (R2/S3)
# - Backup verification
# - Compression (disabled by default on Windows)
# 
# Usage:
#   .\scripts\backup-db.ps1                    # Manual backup
#   .\scripts\backup-db.ps1 -Verify           # Verify last backup
#   .\scripts\backup-db.ps1 -Restore <file>   # Restore from backup
#   .\scripts\backup-db.ps1 -List             # List available backups
# 
# Environment Variables:
#   DATABASE_URL              - Path to database file (default: .\storage\app.db)
#   BACKUP_DIR                - Backup directory (default: .\storage\backups)
#   BACKUP_RETENTION_DAYS     - Days to keep backups (default: 7)
#   BACKUP_COMPRESS           - Compress backups (default: false)
#   R2_ACCESS_KEY_ID          - R2/S3 access key (optional)
#   R2_SECRET_ACCESS_KEY      - R2/S3 secret key (optional)
#   R2_BUCKET                 - R2/S3 bucket name (optional)
#   R2_ENDPOINT               - R2/S3 endpoint (optional)

param(
    [switch]$Verify,
    [switch]$List,
    [string]$Restore,
    [switch]$Help
)

# Configuration
$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl) { $databaseUrl = ".\storage\app.db" }

$backupDir = $env:BACKUP_DIR
if (-not $backupDir) { $backupDir = ".\storage\backups" }

$retentionDays = [int]$env:BACKUP_RETENTION_DAYS
if (-not $retentionDays) { $retentionDays = 7 }

$compress = $false
if ($env:BACKUP_COMPRESS -eq "true") { $compress = $true }

$r2AccessKeyId = $env:R2_ACCESS_KEY_ID
$r2SecretAccessKey = $env:R2_SECRET_ACCESS_KEY
$r2Bucket = $env:R2_BUCKET
$r2Endpoint = $env:R2_ENDPOINT

# Ensure backup directory exists
function Ensure-BackupDir {
    if (-not (Test-Path $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }
}

# Generate backup filename with timestamp
function Get-BackupFilename {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd-HH-mm-ss")
    if ($compress) {
        return "backup-$timestamp.db.gz"
    }
    return "backup-$timestamp.db"
}

# Calculate file hash for verification (custom function to avoid PowerShell object issues)
function Get-FileHashString {
    param([string]$Path)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    $bytes = $hash.ComputeHash($stream)
    $stream.Close()
    $hashString = [System.BitConverter]::ToString($bytes).Replace("-", "").ToLower()
    return $hashString
}

# Create backup
function Create-Backup {
    Write-Host "Starting database backup..." -ForegroundColor Cyan
    
    Ensure-BackupDir
    
    # Check if database exists
    if (-not (Test-Path $databaseUrl)) {
        Write-Error "Database file not found: $databaseUrl"
        exit 1
    }
    
    $backupFilename = Get-BackupFilename
    $backupPath = Join-Path $backupDir $backupFilename
    
    Write-Host "Creating backup: $backupFilename" -ForegroundColor Yellow
    Write-Host "Database: $databaseUrl" -ForegroundColor Gray
    Write-Host "Backup: $backupPath" -ForegroundColor Gray
    Write-Host "Compression: $compress" -ForegroundColor Gray
    
    try {
        # Simple copy (compression disabled on Windows for compatibility)
        Copy-Item $databaseUrl $backupPath
        
        # Verify backup hash
        $originalHash = Get-FileHashString $databaseUrl
        $backupHash = Get-FileHashString $backupPath
        
        if ($originalHash -ne $backupHash) {
            Write-Error "Backup verification failed - hash mismatch"
            Write-Error "Original: $originalHash"
            Write-Error "Backup: $backupHash"
            Remove-Item $backupPath -Force
            exit 1
        }
        
        $fileSize = (Get-Item $backupPath).Length
        Write-Host "Backup verified successfully" -ForegroundColor Green
        Write-Host "Backup size: $fileSize bytes" -ForegroundColor Cyan
        
        # Upload to R2/S3 if configured
        if ($r2AccessKeyId -and $r2SecretAccessKey -and $r2Bucket) {
            Upload-ToR2 $backupPath $backupFilename
        }
        
        # Clean old backups
        Clean-OldBackups
        
        Write-Host "Backup completed successfully" -ForegroundColor Green
        return $backupPath
        
    } catch {
        Write-Error "Backup failed: $_"
        exit 1
    }
}

# Upload backup to R2/S3
function Upload-ToR2 {
    param(
        [string]$LocalPath,
        [string]$Filename
    )
    
    Write-Host "Uploading backup to R2/S3..." -ForegroundColor Cyan
    
    try {
        # Set environment variables for AWS CLI
        $env:AWS_ACCESS_KEY_ID = $r2AccessKeyId
        $env:AWS_SECRET_ACCESS_KEY = $r2SecretAccessKey
        
        $endpointArg = if ($r2Endpoint) { "--endpoint-url $r2Endpoint" } else { "" }
        $command = "aws s3 cp `"$LocalPath`" s3://$r2Bucket/$Filename $endpointArg"
        
        Invoke-Expression $command
        Write-Host "Upload completed" -ForegroundColor Green
    } catch {
        Write-Error "Upload failed: $_"
        Write-Host "Backup retained locally" -ForegroundColor Yellow
    }
}

# Clean old backups based on retention policy
function Clean-OldBackups {
    Write-Host "Cleaning backups older than $retentionDays days..." -ForegroundColor Cyan
    
    try {
        $files = Get-ChildItem $backupDir -Filter "backup-*.db*" | Sort-Object LastWriteTime -Descending
        $now = Get-Date
        $deletedCount = 0
        
        foreach ($file in $files) {
            if (($now - $file.LastWriteTime).Days -gt $retentionDays) {
                Remove-Item $file.FullName -Force
                Write-Host "Deleted old backup: $($file.Name)" -ForegroundColor DarkGray
                $deletedCount++
            }
        }
        
        Write-Host "Cleanup completed: $deletedCount file(s) deleted" -ForegroundColor Green
    } catch {
        Write-Error "Cleanup failed: $_"
    }
}

# Verify backup integrity
function Verify-Backup {
    param([string]$BackupPath)
    
    Write-Host "Verifying backup: $BackupPath" -ForegroundColor Cyan
    
    if (-not (Test-Path $BackupPath)) {
        Write-Error "Backup file not found"
        exit 1
    }
    
    try {
        # Validate as SQLite database
        $stats = Get-Item $BackupPath
        if ($stats.Length -lt 100) {
            throw "File too small to be valid database"
        }
        
        # Try to read SQLite header (first 16 bytes should be "SQLite format 3")
        $bytes = [System.IO.File]::ReadAllBytes($BackupPath)
        $header = [System.Text.Encoding]::UTF8.GetString($bytes[0..15])
        
        if (-not $header.StartsWith("SQLite format 3")) {
            throw "Invalid SQLite header"
        }
        
        Write-Host "Backup is valid SQLite database" -ForegroundColor Green
        Write-Host "File size: $($stats.Length) bytes" -ForegroundColor Cyan
        return $true
    } catch {
        Write-Error "Backup verification failed: $_"
        exit 1
    }
}

# Restore from backup
function Restore-Backup {
    param([string]$BackupPath)
    
    Write-Host "Restoring from backup: $BackupPath" -ForegroundColor Cyan
    
    if (-not (Test-Path $BackupPath)) {
        Write-Error "Backup file not found"
        exit 1
    }
    
    # Verify backup before restoring
    Verify-Backup $BackupPath
    
    try {
        # Create backup of current database before restore
        $currentBackup = Join-Path $backupDir "pre-restore-$((Get-Date).Ticks).db"
        Copy-Item $databaseUrl $currentBackup
        Write-Host "Current database backed up to: $currentBackup" -ForegroundColor Yellow
        
        # Restore database
        Copy-Item $BackupPath $databaseUrl -Force
        
        Write-Host "Restore completed successfully" -ForegroundColor Green
        Write-Host "Previous database saved to: $currentBackup" -ForegroundColor Yellow
    } catch {
        Write-Error "Restore failed: $_"
        exit 1
    }
}

# List available backups
function List-Backups {
    Write-Host "Available backups:" -ForegroundColor Cyan
    
    try {
        $files = Get-ChildItem $backupDir -Filter "backup-*.db*" | Sort-Object LastWriteTime -Descending
        
        if ($files.Count -eq 0) {
            Write-Host "  No backups found" -ForegroundColor Gray
            return
        }
        
        foreach ($file in $files) {
            $sizeMB = [math]::Round($file.Length / 1MB, 2)
            $date = $file.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
            Write-Host "  $($file.Name)" -ForegroundColor White
            Write-Host "    Size: $sizeMB MB" -ForegroundColor Gray
            Write-Host "    Date: $date" -ForegroundColor Gray
            Write-Host ""
        }
    } catch {
        Write-Error "Failed to list backups: $_"
    }
}

# Get latest backup
function Get-LatestBackup {
    try {
        $files = Get-ChildItem $backupDir -Filter "backup-*.db*" | Sort-Object LastWriteTime -Descending
        if ($files.Count -gt 0) {
            return $files[0].Name
        }
        return $null
    } catch {
        return $null
    }
}

# Main
if ($Help) {
    Write-Host @"
Database Backup Script (PowerShell)

Usage:
  .\scripts\backup-db.ps1                    # Create backup
  .\scripts\backup-db.ps1 -Verify           # Verify backup (uses latest if not specified)
  .\scripts\backup-db.ps1 -Restore <file>   # Restore from backup
  .\scripts\backup-db.ps1 -List             # List available backups
  .\scripts\backup-db.ps1 -Help             # Show this help

Environment Variables:
  DATABASE_URL              - Path to database file (default: .\storage\app.db)
  BACKUP_DIR                - Backup directory (default: .\storage\backups)
  BACKUP_RETENTION_DAYS     - Days to keep backups (default: 7)
  BACKUP_COMPRESS           - Compress backups (default: false on Windows)
  R2_ACCESS_KEY_ID          - R2/S3 access key (optional)
  R2_SECRET_ACCESS_KEY      - R2/S3 secret key (optional)
  R2_BUCKET                 - R2/S3 bucket name (optional)
  R2_ENDPOINT               - R2/S3 endpoint (optional)

Note: Compression is disabled by default on Windows due to compatibility issues.
To enable compression, set BACKUP_COMPRESS=true in your environment.
"@
    exit 0
}

if ($List) {
    List-Backups
} elseif ($Restore) {
    Restore-Backup $Restore
} elseif ($Verify) {
    $backupFile = if ($args.Count -gt 0) { $args[0] } else { Get-LatestBackup }
    if (-not $backupFile) {
        Write-Error "No backup file specified and no recent backup found"
        exit 1
    }
    Verify-Backup (Join-Path $backupDir $backupFile)
} else {
    # Default: create backup
    Create-Backup
}
