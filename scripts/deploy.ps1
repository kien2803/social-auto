# Social-Auto Production Deployment Script (Windows)
# This script handles the deployment of the social-auto application to production on Windows

# Error handling
$ErrorActionPreference = "Stop"

# Configuration
$APP_NAME = "social-auto"
$DEPLOY_DIR = "C:\inetpub\wwwroot\$APP_NAME"
$BACKUP_DIR = "C:\backups\$APP_NAME"
$LOG_DIR = "C:\logs\$APP_NAME"
$REPO_URL = "https://github.com/your-username/social-auto.git"  # Update with your repo
$BRANCH = "main"

# Functions
function Log-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Log-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Log-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-Dependencies {
    Log-Info "Installing system dependencies..."
    
    # Check if Node.js is installed
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Log-Warn "Node.js not found. Please install from https://nodejs.org/"
        exit 1
    }
    
    # Check if Git is installed
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Log-Warn "Git not found. Please install from https://git-scm.com/"
        exit 1
    }
    
    # Check if FFmpeg is installed
    if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
        Log-Warn "FFmpeg not found. Please install from https://ffmpeg.org/"
        exit 1
    }
    
    # Install global npm packages
    npm install -g pnpm pm2-windows-startup
    
    Log-Info "System dependencies verified"
}

function Setup-Directories {
    Log-Info "Setting up directories..."
    
    $directories = @(
        $DEPLOY_DIR,
        $BACKUP_DIR,
        $LOG_DIR,
        "$DEPLOY_DIR\storage",
        "$DEPLOY_DIR\core\api\logs",
        "$DEPLOY_DIR\core\worker\logs",
        "$DEPLOY_DIR\core\web\logs"
    )
    
    foreach ($dir in $directories) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
    }
    
    Log-Info "Directories created"
}

function Clone-Repo {
    Log-Info "Cloning repository..."
    
    if (Test-Path "$DEPLOY_DIR\.git") {
        Set-Location $DEPLOY_DIR
        git fetch origin
        git checkout $BRANCH
        git pull origin $BRANCH
    } else {
        git clone $REPO_URL $DEPLOY_DIR
        Set-Location $DEPLOY_DIR
        git checkout $BRANCH
    }
    
    Log-Info "Repository cloned/updated"
}

function Install-NodeDependencies {
    Log-Info "Installing Node.js dependencies..."
    
    Set-Location $DEPLOY_DIR
    pnpm install
    
    Log-Info "Node.js dependencies installed"
}

function Setup-Environment {
    Log-Info "Setting up environment variables..."
    
    $envFile = "$DEPLOY_DIR\.env.production"
    
    if (-not (Test-Path $envFile)) {
        Log-Warn ".env.production not found. Creating from template..."
        
        if (Test-Path "$DEPLOY_DIR\.env.production.example") {
            Copy-Item "$DEPLOY_DIR\.env.production.example" $envFile
        }
        
        Log-Warn "Please edit $envFile with your production values"
        Log-Warn "Required variables: TOKEN_ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET"
        Read-Host "Press Enter after configuring .env.production"
    }
    
    Log-Info "Environment configured"
}

function Backup-Database {
    Log-Info "Backing up database..."
    
    $dbFile = "$DEPLOY_DIR\storage\app.db"
    
    if (Test-Path $dbFile) {
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $backupFile = "$BACKUP_DIR\app.db.$timestamp.bak"
        Copy-Item $dbFile $backupFile
        Log-Info "Database backed up to $backupFile"
    } else {
        Log-Warn "No database found to backup"
    }
}

function Run-Migrations {
    Log-Info "Running database migrations..."
    
    Set-Location "$DEPLOY_DIR\core\api"
    
    try {
        pnpm run migrate
    } catch {
        Log-Warn "No migrations to run"
    }
    
    Log-Info "Migrations completed"
}

function Build-Application {
    Log-Info "Building application..."
    
    Set-Location $DEPLOY_DIR
    pnpm run build
    
    Log-Info "Application built"
}

function Stop-Services {
    Log-Info "Stopping existing services..."
    
    pm2 stop "$APP_NAME-api" -ErrorAction SilentlyContinue
    pm2 stop "$APP_NAME-worker" -ErrorAction SilentlyContinue
    pm2 stop "$APP_NAME-web" -ErrorAction SilentlyContinue
    
    Log-Info "Services stopped"
}

function Start-Services {
    Log-Info "Starting services with PM2..."
    
    Set-Location $DEPLOY_DIR
    pm2 start ecosystem.production.cjs --env production
    pm2 save
    pm2 startup
    
    Log-Info "Services started"
}

function Verify-Deployment {
    Log-Info "Verifying deployment..."
    
    Start-Sleep -Seconds 5
    
    $apiStatus = pm2 list | Select-String "$APP_NAME-api.*online"
    if ($apiStatus) {
        Log-Info "API service is running"
    } else {
        Log-Error "API service failed to start"
        pm2 logs "$APP_NAME-api" --lines 50
        exit 1
    }
    
    $workerStatus = pm2 list | Select-String "$APP_NAME-worker.*online"
    if ($workerStatus) {
        Log-Info "Worker service is running"
    } else {
        Log-Error "Worker service failed to start"
        pm2 logs "$APP_NAME-worker" --lines 50
        exit 1
    }
    
    $webStatus = pm2 list | Select-String "$APP_NAME-web.*online"
    if ($webStatus) {
        Log-Info "Web service is running"
    } else {
        Log-Error "Web service failed to start"
        pm2 logs "$APP_NAME-web" --lines 50
        exit 1
    }
    
    Log-Info "Deployment verified successfully"
}

function Cleanup-OldBackups {
    Log-Info "Cleaning up old backups (keeping last 7 days)..."
    
    $cutoffDate = (Get-Date).AddDays(-7)
    Get-ChildItem $BACKUP_DIR -Filter "*.bak" | Where-Object { $_.LastWriteTime -lt $cutoffDate } | Remove-Item
    
    Log-Info "Old backups cleaned"
}

function Main {
    Log-Info "Starting Social-Auto production deployment..."
    
    if (-not (Test-Admin)) {
        Log-Error "This script must be run as Administrator"
        exit 1
    }
    
    Install-Dependencies
    Setup-Directories
    Clone-Repo
    Install-NodeDependencies
    Setup-Environment
    Backup-Database
    Run-Migrations
    Build-Application
    Stop-Services
    Start-Services
    Verify-Deployment
    Cleanup-OldBackups
    
    Log-Info "Deployment completed successfully!"
    Log-Info "Monitor services with: pm2 monit"
    Log-Info "View logs with: pm2 logs"
}

# Run main function
Main