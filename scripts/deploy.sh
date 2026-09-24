#!/bin/bash

# Social-Auto Production Deployment Script
# This script handles the deployment of the social-auto application to production

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="social-auto"
DEPLOY_DIR="/var/www/${APP_NAME}"
BACKUP_DIR="/var/backups/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
REPO_URL="https://github.com/your-username/social-auto.git"  # Update with your repo
BRANCH="main"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
}

install_dependencies() {
    log_info "Installing system dependencies..."
    apt-get update
    apt-get install -y nodejs npm git ffmpeg curl
    log_info "System dependencies installed"
}

setup_directories() {
    log_info "Setting up directories..."
    mkdir -p "$DEPLOY_DIR"
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$LOG_DIR"
    mkdir -p "$DEPLOY_DIR/storage"
    mkdir -p "$DEPLOY_DIR/core/api/logs"
    mkdir -p "$DEPLOY_DIR/core/worker/logs"
    mkdir -p "$DEPLOY_DIR/core/web/logs"
    log_info "Directories created"
}

clone_repo() {
    log_info "Cloning repository..."
    if [ -d "$DEPLOY_DIR/.git" ]; then
        cd "$DEPLOY_DIR"
        git fetch origin
        git checkout "$BRANCH"
        git pull origin "$BRANCH"
    else
        git clone "$REPO_URL" "$DEPLOY_DIR"
        cd "$DEPLOY_DIR"
        git checkout "$BRANCH"
    fi
    log_info "Repository cloned/updated"
}

install_node_dependencies() {
    log_info "Installing Node.js dependencies..."
    cd "$DEPLOY_DIR"
    npm install -g pnpm pm2
    pnpm install
    log_info "Node.js dependencies installed"
}

setup_environment() {
    log_info "Setting up environment variables..."
    
    if [ ! -f "$DEPLOY_DIR/.env.production" ]; then
        log_warn ".env.production not found. Creating from template..."
        cp "$DEPLOY_DIR/.env.production.example" "$DEPLOY_DIR/.env.production" 2>/dev/null || true
        
        log_warn "Please edit $DEPLOY_DIR/.env.production with your production values"
        log_warn "Required variables: TOKEN_ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET"
        read -p "Press Enter after configuring .env.production..."
    fi
    
    log_info "Environment configured"
}

backup_database() {
    log_info "Backing up database..."
    if [ -f "$DEPLOY_DIR/storage/app.db" ]; then
        BACKUP_FILE="$BACKUP_DIR/app.db.$(date +%Y%m%d_%H%M%S).bak"
        cp "$DEPLOY_DIR/storage/app.db" "$BACKUP_FILE"
        log_info "Database backed up to $BACKUP_FILE"
    else
        log_warn "No database found to backup"
    fi
}

run_migrations() {
    log_info "Running database migrations..."
    cd "$DEPLOY_DIR/core/api"
    pnpm run migrate 2>/dev/null || log_warn "No migrations to run"
    log_info "Migrations completed"
}

build_application() {
    log_info "Building application..."
    cd "$DEPLOY_DIR"
    pnpm run build
    log_info "Application built"
}

stop_services() {
    log_info "Stopping existing services..."
    pm2 stop "$APP_NAME-api" 2>/dev/null || true
    pm2 stop "$APP_NAME-worker" 2>/dev/null || true
    pm2 stop "$APP_NAME-web" 2>/dev/null || true
    log_info "Services stopped"
}

start_services() {
    log_info "Starting services with PM2..."
    cd "$DEPLOY_DIR"
    pm2 start ecosystem.production.cjs --env production
    pm2 save
    pm2 startup
    log_info "Services started"
}

verify_deployment() {
    log_info "Verifying deployment..."
    sleep 5
    
    if pm2 list | grep -q "$APP_NAME-api.*online"; then
        log_info "API service is running"
    else
        log_error "API service failed to start"
        pm2 logs "$APP_NAME-api" --lines 50
        exit 1
    fi
    
    if pm2 list | grep -q "$APP_NAME-worker.*online"; then
        log_info "Worker service is running"
    else
        log_error "Worker service failed to start"
        pm2 logs "$APP_NAME-worker" --lines 50
        exit 1
    fi
    
    if pm2 list | grep -q "$APP_NAME-web.*online"; then
        log_info "Web service is running"
    else
        log_error "Web service failed to start"
        pm2 logs "$APP_NAME-web" --lines 50
        exit 1
    fi
    
    log_info "Deployment verified successfully"
}

cleanup_old_backups() {
    log_info "Cleaning up old backups (keeping last 7 days)..."
    find "$BACKUP_DIR" -name "*.bak" -mtime +7 -delete
    log_info "Old backups cleaned"
}

main() {
    log_info "Starting Social-Auto production deployment..."
    
    check_root
    install_dependencies
    setup_directories
    clone_repo
    install_node_dependencies
    setup_environment
    backup_database
    run_migrations
    build_application
    stop_services
    start_services
    verify_deployment
    cleanup_old_backups
    
    log_info "Deployment completed successfully!"
    log_info "Monitor services with: pm2 monit"
    log_info "View logs with: pm2 logs"
}

# Run main function
main "$@"