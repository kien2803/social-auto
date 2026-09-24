# Troubleshooting Guide

## Overview

This guide covers common issues, their causes, and solutions for social-auto. Issues are categorized by component: API, Worker, Database, OAuth, and Storage.

## Quick Diagnosis

### Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
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
  "accounts": [
    {
      "id": "acc-123",
      "platform": "youtube",
      "display_name": "My Channel",
      "status": "active"
    }
  ]
}
```

### Service Status

```bash
# Check PM2 status
pm2 status

# Check API logs
pm2 logs social-auto-api

# Check worker logs
pm2 logs social-auto-worker

# Check combined logs
pm2 logs
```

## API Issues

### 1. API Won't Start

**Symptoms:**
- Process exits immediately
- Port already in use error
- Database connection error

**Solutions:**

**Port conflict:**
```bash
# Find process using port 3000
netstat -ano | findstr :3000

# Kill the process
taskkill /PID <pid> /F

# Or change port in .env.local
API_PORT=3001
```

**Database error:**
```bash
# Check database file exists
ls -la storage/app.db

# Check database permissions
chmod 644 storage/app.db

# Recreate database if corrupted
rm storage/app.db
pnpm core:dev:api
```

**Environment variables missing:**
```bash
# Check .env.local exists
ls -la .env.local

# Verify required variables
grep TOKEN_ENCRYPTION_KEY .env.local
grep GOOGLE_CLIENT_ID .env.local
```

### 2. Upload Fails

**Symptoms:**
- Upload progress stuck
- 413 Payload Too Large error
- 415 Unsupported Media Type error

**Solutions:**

**File too large:**
```bash
# Check max file size
grep MAX_VIDEO_SIZE .env.local

# Increase limit in .env.local
MAX_VIDEO_SIZE_GB=5
```

**Invalid file format:**
```bash
# Check file type
file video.mp4

# Convert to supported format
ffmpeg -i input.mov -c:v libx264 -c:a aac output.mp4
```

**Disk space full:**
```bash
# Check storage usage
curl http://localhost:3000/storage/usage

# Trigger cleanup
curl -X POST http://localhost:3000/storage/cleanup
```

### 3. OAuth Connection Fails

**Symptoms:**
- OAuth flow redirects to error page
- Token refresh fails
- Account shows as expired

**Solutions:**

**Invalid redirect URI:**
```bash
# Check redirect URI matches Google Console
grep GOOGLE_REDIRECT_URI .env.local

# Update in Google Console:
# https://console.cloud.google.com/apis/credentials
```

**Client ID/Secret incorrect:**
```bash
# Verify credentials in .env.local
grep GOOGLE_CLIENT_ID .env.local
grep GOOGLE_CLIENT_SECRET .env.local

# Regenerate in Google Console if needed
```

**OAuth consent screen not configured:**
```bash
# Check consent screen status
# https://console.cloud.google.com/apis/credentials/consent

# Add your email to test users
```

## Worker Issues

### 1. Worker Won't Start

**Symptoms:**
- Process exits immediately
- Database connection error
- Missing environment variables

**Solutions:**

**Database path incorrect:**
```bash
# Check database path
grep DATABASE_URL .env.local

# Verify file exists
ls -la storage/app.db
```

**Missing encryption key:**
```bash
# Check encryption key
grep TOKEN_ENCRYPTION_KEY .env.local

# Generate new key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Google credentials missing:**
```bash
# Check Google credentials
grep GOOGLE_CLIENT_ID .env.local
grep GOOGLE_CLIENT_SECRET .env.local
```

### 2. Worker Not Processing Posts

**Symptoms:**
- Posts stuck in `pending` status
- Worker logs show no activity
- Last publish timestamp old

**Solutions:**

**Worker not running:**
```bash
# Check worker status
pm2 status

# Restart worker
pm2 restart social-auto-worker
```

**Database connection issue:**
```bash
# Check worker logs
pm2 logs social-auto-worker

# Verify database accessible
sqlite3 storage/app.db "SELECT * FROM scheduled_posts LIMIT 5"
```

**Scheduled time in future:**
```bash
# Check scheduled times
sqlite3 storage/app.db "SELECT id, scheduled_at, status FROM scheduled_posts WHERE status='pending'"

# Worker only processes posts where scheduled_at <= now
```

### 3. Upload Fails in Worker

**Symptoms:**
- Posts stuck in `uploading` status
- Upload errors in logs
- Quota exceeded errors

**Solutions:**

**Network issues:**
```bash
# Check internet connectivity
ping google.com

# Check YouTube API status
https://status.cloud.google.com/
```

**Quota exceeded:**
```bash
# Check quota status
curl http://localhost:3000/quota/youtube

# Wait for quota reset (midnight UTC)
# Or increase quota in Google Console
```

**Token expired:**
```bash
# Check account status
sqlite3 storage/app.db "SELECT id, platform, status FROM accounts WHERE platform='youtube'"

# Reconnect account via UI
```

## Database Issues

### 1. Database Corruption

**Symptoms:**
- SQLite database locked error
- Database malformed error
- Queries fail unexpectedly

**Solutions:**

**Database locked:**
```bash
# Check for other processes using database
lsof storage/app.db  # Linux
tasklist | findstr node  # Windows

# Stop other processes
pm2 stop all

# Or use SQLite timeout
export SQLITE_TIMEOUT=5000
```

**Database corrupted:**
```bash
# Check database integrity
sqlite3 storage/app.db "PRAGMA integrity_check"

# Restore from backup
node scripts/backup-db.js --restore backup-2025-09-19-14-30-00.db
```

### 2. Migration Errors

**Symptoms:**
- Schema mismatch errors
- Column not found errors
- Migration fails to apply

**Solutions:**

**Force migration:**
```bash
# Delete database and restart
rm storage/app.db
pnpm core:dev:api
```

**Check migration status:**
```bash
# View migration table
sqlite3 storage/app.db "SELECT * FROM migrations"

# Manually apply migration if needed
```

## Storage Issues

### 1. Disk Space Full

**Symptoms:**
- Upload fails with 507 error
- Cannot write to storage directory
- System disk full warnings

**Solutions:**

**Check disk space:**
```bash
# Check available space
df -h  # Linux
wmic logicaldisk get size,freespace  # Windows

# Check storage usage
curl http://localhost:3000/storage/usage
```

**Trigger cleanup:**
```bash
# Manual cleanup
curl -X POST http://localhost:3000/storage/cleanup

# Enforce quota
curl -X POST http://localhost:3000/storage/enforce-quota
```

**Increase storage quota:**
```bash
# Update .env.local
STORAGE_QUOTA_GB=20

# Restart API
pm2 restart social-auto-api
```

### 2. Orphaned Files

**Symptoms:**
- Storage usage high but few videos
- Files not referenced in database
- Cleanup not removing files

**Solutions:**

**Manual cleanup:**
```bash
# List orphaned files
cd storage
ls -la | grep -v app.db

# Remove orphaned files (carefully)
rm orphaned-file.mp4
```

**Check database references:**
```bash
# Check all video files in database
sqlite3 storage/app.db "SELECT file_path FROM videos"

# Compare with actual files
ls storage/*.mp4
```

## OAuth Issues

### 1. Token Refresh Fails

**Symptoms:**
- Account status becomes `expired`
- Upload fails with authentication error
- Token refresh errors in logs

**Solutions:**

**Refresh token invalid:**
```bash
# Check account status
sqlite3 storage/app.db "SELECT id, status FROM accounts WHERE platform='youtube'"

# Reconnect account via UI
# Navigate to /accounts and click "Connect YouTube"
```

**Refresh token expired:**
```bash
# Google refresh tokens can expire if not used for 6 months
# User must re-authorize via OAuth flow
```

**API credentials changed:**
```bash
# Update Google credentials in .env.local
# Reconnect account via UI
```

### 2. OAuth Flow Fails

**Symptoms:**
- OAuth redirect fails
- Callback returns error
- State mismatch error

**Solutions:**

**State parameter mismatch:**
```bash
# Clear browser cookies
# Restart OAuth flow
```

**Redirect URI mismatch:**
```bash
# Check redirect URI in .env.local
grep GOOGLE_REDIRECT_URI .env.local

# Must match Google Console exactly
```

**CORS issues:**
```bash
# Check web origin in .env.local
grep WEB_ORIGIN .env.local

# Must match actual domain
```

## Performance Issues

### 1. Slow Uploads

**Symptoms:**
- Upload progress slow
- High memory usage
- Network timeouts

**Solutions:**

**Check network speed:**
```bash
# Test upload speed
curl -o /dev/null http://speedtest.tele2.net/1MB.zip

# Check YouTube API status
https://status.cloud.google.com/
```

**Reduce file size:**
```bash
# Compress video
ffmpeg -i input.mp4 -b:v 1M -b:a 128k output.mp4

# Reduce resolution
ffmpeg -i input.mp4 -vf scale=1280:720 output.mp4
```

**Check system resources:**
```bash
# Check CPU usage
top  # Linux
tasklist  # Windows

# Check memory usage
pm2 monit
```

### 2. High Memory Usage

**Symptoms:**
- Process crashes with OOM error
- Memory usage grows over time
- System becomes slow

**Solutions:**

**Check memory leaks:**
```bash
# Monitor memory usage
pm2 monit

# Check for memory leaks in logs
pm2 logs social-auto-api
```

**Increase memory limit:**
```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'social-auto-api',
      max_memory_restart: '500M',
    },
  ],
};
```

**Restart services:**
```bash
pm2 restart all
```

## Network Issues

### 1. API Not Accessible

**Symptoms:**
- Cannot connect to API
- Connection refused error
- Timeout errors

**Solutions:**

**Check API running:**
```bash
# Check API status
pm2 status

# Check API logs
pm2 logs social-auto-api
```

**Check firewall:**
```bash
# Windows Firewall
# Allow Node.js through firewall

# Linux iptables
sudo iptables -L -n
```

**Check port binding:**
```bash
# Check port 3000
netstat -ano | findstr :3000

# Try different port
API_PORT=3001 pnpm core:dev:api
```

### 2. YouTube API Unreachable

**Symptoms:**
- Upload fails with network error
- DNS resolution fails
- Connection timeout

**Solutions:**

**Check DNS:**
```bash
# Test DNS resolution
nslookup googleapis.com

# Try different DNS server
# Update /etc/resolv.conf (Linux)
# Network settings (Windows)
```

**Check proxy settings:**
```bash
# Check if proxy required
# Configure proxy in .env.local
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=http://proxy.example.com:8080
```

**Check YouTube API status:**
```bash
# Check status page
https://status.cloud.google.com/
```

## Logging and Debugging

### Enable Debug Logging

```bash
# Set debug log level
LOG_LEVEL=debug pnpm core:dev:api
LOG_LEVEL=debug pnpm core:dev:worker
```

### View Logs

```bash
# Real-time logs
pm2 logs

# API logs only
pm2 logs social-auto-api

# Worker logs only
pm2 logs social-auto-worker

# Last 100 lines
pm2 logs --lines 100

# Logs with timestamps
pm2 logs --timestamp
```

### Export Logs

```bash
# Export logs to file
pm2 logs > logs.txt

# Export specific app logs
pm2 logs social-auto-api > api-logs.txt
```

## Recovery Procedures

### 1. Complete System Recovery

**Steps:**
1. Stop all services
2. Backup current database
3. Check system resources
4. Restore from last known good state
5. Restart services
6. Verify health check

```bash
# Stop services
pm2 stop all

# Backup database
node scripts/backup-db.js

# Check resources
df -h
free -h

# Restart services
pm2 start ecosystem.config.cjs

# Verify health
curl http://localhost:3000/health
```

### 2. Database Recovery

**Steps:**
1. Identify corruption
2. Stop all services
3. Restore from backup
4. Verify integrity
5. Restart services

```bash
# Stop services
pm2 stop all

# List backups
node scripts/backup-db.js --list

# Restore from backup
node scripts/backup-db.js --restore backup-2025-09-19-14-30-00.db

# Verify integrity
sqlite3 storage/app.db "PRAGMA integrity_check"

# Restart services
pm2 start ecosystem.config.cjs
```

### 3. OAuth Recovery

**Steps:**
1. Identify affected accounts
2. Clear expired tokens
3. Re-authorize accounts
4. Verify status

```bash
# Check expired accounts
sqlite3 storage/app.db "SELECT id, platform, status FROM accounts WHERE status='expired'"

# Clear expired tokens (requires UI action)
# Navigate to /accounts and reconnect

# Verify status
sqlite3 storage/app.db "SELECT id, platform, status FROM accounts"
```

## Prevention

### Regular Maintenance

**Daily:**
- Check health endpoint
- Review logs for errors
- Monitor storage usage

**Weekly:**
- Review quota usage
- Check database backup status
- Monitor system resources

**Monthly:**
- Review and rotate logs
- Update dependencies
- Security audit

### Monitoring Setup

**Health Check Monitoring:**
```bash
# Add to cron job
*/5 * * * * curl -f http://localhost:3000/health || alert
```

**Log Monitoring:**
```bash
# Monitor for errors
pm2 logs | grep -i error

# Monitor for warnings
pm2 logs | grep -i warn
```

**Storage Monitoring:**
```bash
# Monitor storage usage
watch -n 3600 'curl http://localhost:3000/storage/usage'
```

## Getting Help

### Collect Diagnostic Information

```bash
# System information
uname -a
node --version
pnpm --version

# Service status
pm2 status
pm2 info

# Logs
pm2 logs --lines 100 > diagnostic-logs.txt

# Database info
sqlite3 storage/app.db ".schema"
sqlite3 storage/app.db "SELECT COUNT(*) FROM videos"
sqlite3 storage.app.db "SELECT COUNT(*) FROM scheduled_posts"

# Storage info
curl http://localhost:3000/storage/usage
curl http://localhost:3000/quota/youtube
```

### Report Issues

When reporting issues, include:
- System information
- Service status
- Relevant logs
- Steps to reproduce
- Expected vs actual behavior

## References

- **API Documentation:** `docs/youtube-api-integration.md`
- **Storage Management:** `docs/storage-management.md`
- **Database Backup:** `docs/database-backup.md`
- **Project README:** `README.md`
- **Plans:** `plans/README.md`