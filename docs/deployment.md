# Deployment Guide

## Overview

This guide covers deploying social-auto to production environments. It includes environment setup, configuration, deployment procedures, and post-deployment verification.

## Prerequisites

### System Requirements

- **Node.js:** v20.x or higher
- **pnpm:** v9.0.0 or higher
- **Database:** SQLite (included)
- **Storage:** Local filesystem with sufficient disk space
- **Process Manager:** PM2 (recommended)
- **Reverse Proxy:** Nginx (recommended for production)

### External Services

- **Google Cloud Project:** For YouTube OAuth
- **YouTube Data API v3:** Enabled in Google Console
- **Optional:** Sentry for error tracking
- **Optional:** Cloudflare R2/AWS S3 for off-site backups

## Environment Setup

### 1. Server Preparation

**Ubuntu/Debian:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
npm install -g pnpm

# Install PM2
npm install -g pm2

# Install ffmpeg (required for video processing)
sudo apt install -y ffmpeg

# Create application user
sudo useradd -m -s /bin/bash social-auto
sudo su - social-auto
```

**Windows:**
```powershell
# Install Node.js from https://nodejs.org/
# Install pnpm
npm install -g pnpm

# Install PM2
npm install -g pm2

# Install ffmpeg from https://ffmpeg.org/
```

### 2. Application Setup

```bash
# Clone repository
git clone https://github.com/your-username/social-auto.git
cd social-auto

# Install dependencies
pnpm install

# Build application
pnpm core:build
```

### 3. Environment Configuration

Create `.env.production`:
```bash
# Required
TOKEN_ENCRYPTION_KEY=your_32_byte_encryption_key_here
DATABASE_URL=./storage/app.db
STORAGE_DIR=./storage
STORAGE_QUOTA_GB=10

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://your-domain.com/auth/callback

# TikTok OAuth (optional)
TIKTOK_CLIENT_KEY=your_tiktok_client_key
TIKTOK_CLIENT_SECRET=your_tiktok_client_secret
TIKTOK_REDIRECT_URI=https://your-domain.com/auth/tiktok/callback

# Meta OAuth (optional)
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_REDIRECT_URI=https://your-domain.com/auth/meta/callback
META_API_VERSION=v19.0

# API Configuration
API_HOST=0.0.0.0
API_PORT=3000
WEB_ORIGIN=https://your-domain.com

# Production Settings
NODE_ENV=production
LOG_LEVEL=info
USE_MOCK_GOOGLE=false
```

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Deployment Options

### Option 1: PM2 Deployment (Recommended)

**PM2 Configuration:**
```javascript
// ecosystem.production.cjs
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'social-auto-api',
      script: path.join(__dirname, 'core/api/src/server.ts'),
      interpreter: 'node',
      interpreter_args: '--loader tsx',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        API_HOST: '0.0.0.0',
        API_PORT: 3000,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_file: './logs/api-combined.log',
      time: true,
      max_memory_restart: '500M',
      autorestart: true,
      watch: false,
    },
    {
      name: 'social-auto-worker',
      script: path.join(__dirname, 'core/worker/src/index.ts'),
      interpreter: 'node',
      interpreter_args: '--loader tsx',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_file: './logs/worker-combined.log',
      time: true,
      max_memory_restart: '500M',
      autorestart: true,
      watch: false,
    },
  ],
};
```

**Deploy with PM2:**
```bash
# Load environment variables
export $(cat .env.production | xargs)

# Start applications
pm2 start ecosystem.production.cjs

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
```

### Option 2: Docker Deployment

**Dockerfile (API):**
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache ffmpeg

# Copy package files
COPY package*.json pnpm-lock.yaml ./
COPY core/api/package*.json ./core/api/
COPY core/worker/package*.json ./core/worker/
COPY core/web/package*.json ./core/web/
COPY core/packages/shared/package*.json ./core/packages/shared/

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY core/ ./core/

# Build application
RUN pnpm core:build

# Expose port
EXPOSE 3000

# Start application
CMD ["pm2", "start", "ecosystem.config.cjs", "--no-daemon"]
```

**Docker Compose:**
```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
    volumes:
      - ./storage:/app/storage
      - ./logs:/app/logs
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
    volumes:
      - ./storage:/app/storage
      - ./logs:/app/logs
    restart: unless-stopped
    command: pm2 start ecosystem.config.cjs --no-daemon --only social-auto-worker
```

**Deploy with Docker:**
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Option 3: Railway Deployment

**Railway Configuration:**
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "cd core/api && pnpm start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**Deploy to Railway:**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

## Reverse Proxy Configuration

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/social-auto
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL certificates (Let's Encrypt recommended)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # API proxy
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket support for progress tracking
    location /videos/:id/progress/stream {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Static files for web UI (if deployed separately)
    location /static/ {
        alias /path/to/web/dist/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Enable configuration:**
```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/social-auto /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### SSL Certificate Setup

**Let's Encrypt:**
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal (already configured)
sudo certbot renew --dry-run
```

## Database Setup

### 1. Initial Database Creation

```bash
# Create storage directory
mkdir -p storage backups logs

# Set permissions
chmod 755 storage
chmod 700 storage/backups
chmod 755 logs
```

### 2. Database Backup Setup

**PM2 Backup Job:**
```bash
# Add backup job to PM2
pm2 start ecosystem-backup.config.cjs

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup
```

**Manual Backup:**
```bash
# Create backup
node scripts/backup-db.js

# List backups
node scripts/backup-db.js --list

# Verify backup
node scripts/backup-db.js --verify
```

### 3. Database Migration

```bash
# Migrations run automatically on startup
# No manual intervention required

# Verify migration status
sqlite3 storage/app.db "SELECT * FROM migrations"
```

## Monitoring and Logging

### 1. PM2 Monitoring

```bash
# Real-time monitoring
pm2 monit

# Check status
pm2 status

# View logs
pm2 logs

# Log management
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 2. Health Check Monitoring

```bash
# Check health endpoint
curl http://localhost:3000/health

# Add to monitoring system
# Configure alerts for non-200 responses
```

### 3. Log Aggregation

**Filebeat (ELK Stack):**
```yaml
# filebeat.yml
filebeat.inputs:
- type: log
  enabled: true
  paths:
    - /home/social-auto/logs/*.log

output.elasticsearch:
  hosts: ["localhost:9200"]
```

**Papertrail (SaaS):**
```bash
# Install remote syslog
sudo apt install rsyslog

# Configure Papertrail
# /etc/rsyslog.d/99-papertrail.conf
*.* @logs5.papertrailapp.com:12345
```

## Security Hardening

### 1. Firewall Configuration

```bash
# Ubuntu UFW
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw deny 3000/tcp   # Block direct API access
sudo ufw enable
```

### 2. Application Security

**Environment Variables:**
- Never commit `.env.production` to version control
- Use strong encryption keys (32 bytes)
- Rotate secrets regularly

**File Permissions:**
```bash
# Restrict file permissions
chmod 600 .env.production
chmod 700 storage
chmod 644 storage/*.db
```

**HTTPS Only:**
- Force HTTPS in Nginx configuration
- Use HSTS headers
- Keep SSL certificates updated

### 3. Rate Limiting

**Nginx Rate Limiting:**
```nginx
# Add to http block
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

# Add to location block
limit_req zone=api_limit burst=20 nodelay;
```

## Performance Optimization

### 1. System Optimization

**Kernel Parameters:**
```bash
# /etc/sysctl.conf
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0

# Apply changes
sudo sysctl -p
```

**File Descriptors:**
```bash
# Increase file descriptor limit
ulimit -n 65536

# Make permanent
# /etc/security/limits.conf
* soft nofile 65536
* hard nofile 65536
```

### 2. Application Optimization

**PM2 Cluster Mode:**
```javascript
// ecosystem.production.cjs
module.exports = {
  apps: [
    {
      name: 'social-auto-api',
      instances: 'max', // Use all CPU cores
      exec_mode: 'cluster',
      // ... other config
    },
  ],
};
```

**Caching:**
- Enable Nginx caching for static files
- Use Redis for session storage (if scaling)
- Cache YouTube API responses

## Post-Deployment Verification

### 1. Health Check

```bash
# Check API health
curl http://localhost:3000/health

# Expected response
{
  "status": "ok",
  "uptime_sec": 3600,
  "timestamp": 1695123456789,
  "storage_dir": "./storage",
  "worker": {
    "status": "ok",
    "last_publish_at": 1695123450000,
    "by_status": {
      "pending": 5,
      "uploading": 1,
      "published": 42,
      "failed": 2
    }
  },
  "accounts": [...]
}
```

### 2. Service Status

```bash
# Check PM2 status
pm2 status

# Expected output
┌─────┬────────────────────┬─────────┬─────────┬─────────┬──────────┬──────────┐
│ id  │ name               │ mode    │ status  │ restart │ cpu      │ memory   │
├─────┼────────────────────┼─────────┼─────────┼─────────┼──────────┼──────────┤
│ 0   │ social-auto-api    │ fork    │ online  │ 0       │ 0%       │ 100MB    │
│ 1   │ social-auto-worker     │ fork    │ online  │ 0       │ 0%       │ 80MB     │
└─────┴────────────────────┴─────────┴─────────┴─────────┴──────────┴──────────┘
```

### 3. OAuth Test

```bash
# Navigate to https://your-domain.com/accounts
# Click "Connect YouTube"
# Complete OAuth flow
# Verify account appears as "Connected"
```

### 4. Upload Test

```bash
# Upload a test video
# Schedule for "now + 2 minutes"
# Verify video appears on YouTube
# Check worker logs for successful upload
```

## Maintenance

### 1. Regular Updates

**Weekly:**
- Check system updates
- Review logs for errors
- Monitor storage usage

**Monthly:**
- Update dependencies
- Review security patches
- Test backup restoration

### 2. Backup Verification

```bash
# Test backup restoration
node scripts/backup-db.js --verify

# Test restore to test database
node scripts/backup-db.js --restore backup-2025-09-19-14-30-00.db
```

### 3. Log Rotation

**PM2 Log Rotation:**
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
```

### 4. SSL Certificate Renewal

**Let's Encrypt Auto-Renewal:**
```bash
# Test renewal
sudo certbot renew --dry-run

# Renewal is automatic via cron
# Verify cron job exists
sudo systemctl status certbot.timer
```

## Scaling

### 1. Horizontal Scaling

**Multiple API Instances:**
```javascript
// ecosystem.production.cjs
module.exports = {
  apps: [
    {
      name: 'social-auto-api',
      instances: 4,
      exec_mode: 'cluster',
      // ... other config
    },
  ],
};
```

**Load Balancing:**
- Use Nginx as load balancer
- Configure upstream block
- Enable health checks

### 2. Database Scaling

**SQLite Limitations:**
- Single writer at a time
- Not suitable for high-concurrency
- Consider PostgreSQL for scaling

**Migration to PostgreSQL:**
- Replace SQLite with PostgreSQL
- Update database configuration
- Migrate existing data
- Update connection pooling

## Rollback Procedures

### 1. Application Rollback

```bash
# Stop current version
pm2 stop all

# Checkout previous version
git checkout <previous-tag>

# Rebuild
pnpm install
pnpm core:build

# Restart
pm2 start ecosystem.production.cjs
```

### 2. Database Rollback

```bash
# Stop services
pm2 stop all

# Restore from backup
node scripts/backup-db.js --restore backup-2025-09-19-14-30-00.db

# Restart services
pm2 start ecosystem.production.cjs
```

### 3. Configuration Rollback

```bash
# Restore previous .env.production
cp .env.production.backup .env.production

# Restart services
pm2 restart all
```

## CI/CD Integration

### GitHub Actions

The project includes a GitHub Actions workflow (`.github/workflows/ci.yml`) that:
- Runs tests on every push
- Deploys web to Vercel on main branch
- Can be extended for full deployment

### Automated Deployment

**Add deployment step to CI/CD:**
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to server
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /path/to/social-auto
            git pull origin main
            pnpm install
            pnpm core:build
            pm2 restart all
```

## Troubleshooting Deployment Issues

### 1. Port Already in Use

```bash
# Find process using port
netstat -ano | findstr :3000

# Kill process
taskkill /PID <pid> /F

# Or change port in .env.production
API_PORT=3001
```

### 2. Permission Denied

```bash
# Check file permissions
ls -la storage/

# Fix permissions
chmod 755 storage
chmod 644 storage/*.db
```

### 3. Database Locked

```bash
# Stop all services
pm2 stop all

# Check for lock files
ls -la storage/*.db-shm
ls -la storage/*.db-wal

# Remove lock files
rm storage/*.db-shm storage/*.db-wal

# Restart services
pm2 start all
```

## References

- **YouTube API Guide:** `docs/youtube-api-integration.md`
- **Storage Management:** `docs/storage-management.md`
- **Troubleshooting:** `docs/troubleshooting.md`
- **Database Backup:** `docs/database-backup.md`
- **PM2 Documentation:** https://pm2.keymetrics.io/docs/
- **Nginx Documentation:** https://nginx.org/en/docs/