#!/bin/bash
# DigitalOcean Deployment Script for social-auto
# Run this on your DigitalOcean droplet after SSH in
# Usage: bash deploy-digitalocean.sh

set -e  # Exit on error

echo "🚀 Starting social-auto deployment on DigitalOcean..."
echo "================================================"

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Functions
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Step 1: Update system
print_info "Step 1: Updating system packages..."
apt update && apt upgrade -y
print_success "System updated"

# Step 2: Install Docker
print_info "Step 2: Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
    print_success "Docker installed"
else
    print_success "Docker already installed"
fi

# Step 3: Install Docker Compose
print_info "Step 3: Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    print_success "Docker Compose installed"
else
    print_success "Docker Compose already installed"
fi

# Step 4: Install Node.js (needed for backup script)
print_info "Step 4: Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    print_success "Node.js installed"
else
    print_success "Node.js already installed"
fi

# Step 5: Install Git
print_info "Step 5: Installing Git..."
if ! command -v git &> /dev/null; then
    apt install -y git
    print_success "Git installed"
else
    print_success "Git already installed"
fi

# Step 6: Clone repository
print_info "Step 6: Cloning repository..."
cd /opt
if [ -d "social-auto" ]; then
    print_info "Repository already exists, pulling latest changes..."
    cd social-auto
    git pull origin master
else
    git clone https://github.com/kien2803/social-auto.git
    cd social-auto
    print_success "Repository cloned"
fi

# Step 7: Generate encryption key
print_info "Step 7: Generating TOKEN_ENCRYPTION_KEY..."
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
print_success "Encryption key generated"

# Step 8: Create .env file
print_info "Step 8: Creating .env file..."
cat > .env << EOF
API_PORT=3000
API_HOST=0.0.0.0
WEB_ORIGIN=https://social-auto-three.vercel.app
DATABASE_URL=./storage/app.db
STORAGE_DIR=./storage
STORAGE_QUOTA_GB=10
TOKEN_ENCRYPTION_KEY=$TOKEN_ENCRYPTION_KEY
USE_MOCK_GOOGLE=true
USE_MOCK_PUBLISHERS=true
USE_MOCK_TIKTOK=true
USE_MOCK_META=true
LOG_LEVEL=info
NODE_ENV=production
APP_VERSION=0.1.0
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
BACKUP_DIR=./storage/backups
BACKUP_RETENTION_DAYS=7
BACKUP_COMPRESS=false
EOF
print_success ".env file created"

# Step 9: Create storage directories
print_info "Step 9: Creating storage directories..."
mkdir -p storage storage/backups
chmod 755 storage
print_success "Storage directories created"

# Step 10: Build and deploy with Docker Compose
print_info "Step 10: Building Docker images..."
docker-compose build
print_success "Docker images built"

print_info "Step 11: Starting services..."
docker-compose up -d
print_success "Services started"

# Step 12: Wait for services to be healthy
print_info "Step 12: Waiting for services to be healthy..."
sleep 10
docker-compose ps

# Step 13: Verify deployment
print_info "Step 13: Verifying deployment..."
curl -f http://localhost:3000/health || print_error "Health check failed"
print_success "Deployment verified"

# Step 14: Setup UFW firewall
print_info "Step 14: Setting up UFW firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw --force enable
print_success "Firewall configured"

# Step 15: Setup backup cron job
print_info "Step 15: Setting up backup cron job..."
chmod +x scripts/setup-backup-cron.sh
./scripts/setup-backup-cron.sh "0 2 * * *"
print_success "Backup cron job configured"

# Step 16: Display deployment info
echo ""
echo "================================================"
print_success "Deployment completed successfully!"
echo ""
echo "📊 Deployment Information:"
echo "  - API URL: http://$(curl -s ifconfig.me):3000"
echo "  - Health Check: http://$(curl -s ifconfig.me):3000/health"
echo "  - Storage: /opt/social-auto/storage"
echo "  - Backups: /opt/social-auto/storage/backups"
echo ""
echo "🔧 Useful Commands:"
echo "  - View logs: docker-compose logs -f"
echo "  - Restart services: docker-compose restart"
echo "  - Stop services: docker-compose down"
echo "  - Manual backup: docker-compose -f docker-compose.backup.yml run --rm backup"
echo "  - List backups: docker-compose -f docker-compose.backup.yml run --rm backup --list"
echo ""
echo "📝 Next Steps:"
echo "  1. Setup Nginx reverse proxy (optional but recommended)"
echo "  2. Configure SSL with Let's Encrypt (optional but recommended)"
echo "  3. Add custom domain (optional)"
echo "  4. Configure Sentry DSN for error tracking (optional)"
echo ""
echo "================================================"
