# Database Backup Automation

## Overview

The social-auto project now includes automated database backup functionality with:

- **Daily scheduled backups** via cron (Linux/Mac) or Task Scheduler (Windows)
- **Retention policy** (configurable, default 7 days)
- **Compression** (gzip on Unix, disabled on Windows by default)
- **Backup verification** using SHA256 hash checks
- **Off-site storage** support (Cloudflare R2, AWS S3, or S3-compatible)
- **Manual backup/restore** commands
- **Pre-restore safety** (automatic backup before restore)

## Quick Start

### Manual Backup

```bash
# Linux/Mac
node scripts/backup-db.js

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1

# Or using npm script
npm run backup
```

### List Available Backups

```bash
# Linux/Mac
node scripts/backup-db.js --list

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -List

# Or using npm script
npm run backup:list
```

### Verify Backup

```bash
# Linux/Mac - verify latest backup
node scripts/backup-db.js --verify

# Linux/Mac - verify specific backup
node scripts/backup-db.js --verify backup-2025-09-19-14-30-00.db

# Windows PowerShell - verify latest
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -Verify

# Windows PowerShell - verify specific
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -Verify backup-2025-09-19-14-30-00.db

# Or using npm script
npm run backup:verify
```

### Restore from Backup

```bash
# Linux/Mac
node scripts/backup-db.js --restore backup-2025-09-19-14-30-00.db

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -Restore backup-2025-09-19-14-30-00.db
```

⚠️ **Warning**: Restore automatically backs up the current database before restoring.

## Automated Backups

### Linux/Mac (PM2 + Cron)

1. **Add backup job to PM2:**
```bash
pm2 start ecosystem-backup.config.cjs
pm2 save
pm2 startup
```

2. **Customize schedule** in `ecosystem-backup.config.cjs`:
```javascript
// Default: 2 AM daily
cron: '0 2 * * *'

// Every 6 hours
cron: '0 */6 * * *'

// Every Sunday at 3 AM
cron: '0 3 * * 0'
```

### Windows (Task Scheduler)

1. **Run setup script:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-backup-task.ps1
```

2. **Customize schedule:**
```powershell
# Run at 3 AM instead of 2 AM
powershell -ExecutionPolicy Bypass -File scripts\setup-backup-task.ps1 -ScheduleTime "03:00"

# Remove the task
powershell -ExecutionPolicy Bypass -File scripts\setup-backup-task.ps1 -Remove
```

## Configuration

### Environment Variables

Add these to your `.env.local` file:

```bash
# Database Backup Configuration
DATABASE_URL=./storage/app.db              # Path to database file
BACKUP_DIR=./storage/backups               # Backup directory
BACKUP_RETENTION_DAYS=7                    # Days to keep backups
BACKUP_COMPRESS=true                       # Compress backups (Unix only, disabled on Windows by default)

# Optional: Off-site Storage (Cloudflare R2, AWS S3, etc.)
R2_ACCESS_KEY_ID=your_access_key_here
R2_SECRET_ACCESS_KEY=your_secret_key_here
R2_BUCKET=your-bucket-name
R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
```

### Retention Policy

Backups older than `BACKUP_RETENTION_DAYS` are automatically deleted. Default is 7 days.

To change retention:
```bash
# Keep 30 days
BACKUP_RETENTION_DAYS=30

# Keep 1 day
BACKUP_RETENTION_DAYS=1
```

### Compression

**Note**: Compression is currently disabled by default on Windows due to compatibility issues. It is enabled by default on Unix-like systems.

To enable compression on Windows:
```bash
BACKUP_COMPRESS=true
```

To disable compression on Unix:
```bash
BACKUP_COMPRESS=false
```

## Off-site Storage (R2/S3)

### Cloudflare R2 Setup

1. **Create R2 bucket** in Cloudflare dashboard
2. **Get API credentials** (Access Key ID + Secret Access Key)
3. **Add to .env.local:**
```bash
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET=social-auto-backups
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

### AWS S3 Setup

1. **Create S3 bucket**
2. **Create IAM user** with S3 write permissions
3. **Add to .env.local:**
```bash
R2_ACCESS_KEY_ID=your_aws_access_key
R2_SECRET_ACCESS_KEY=your_aws_secret_key
R2_BUCKET=social-auto-backups
# No R2_ENDPOINT needed for AWS S3
```

### Other S3-Compatible Storage

Works with any S3-compatible storage (MinIO, DigitalOcean Spaces, etc.):

```bash
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=your-bucket-name
R2_ENDPOINT=https://your-storage-endpoint.com
```

## Backup Verification

Each backup is automatically verified using:

1. **SHA256 hash comparison** between original and backup
2. **SQLite database validation** using header check
3. **Automatic cleanup** of temporary verification files

If verification fails, the backup is deleted and an error is reported.

## Restore Process

The restore process includes safety measures:

1. **Pre-restore backup**: Current database is backed up to `pre-restore-<timestamp>.db`
2. **Backup verification**: Source backup is verified before restore
3. **Atomic restore**: Database is replaced only after successful verification
4. **Rollback**: You can restore the pre-restore backup if needed

## Monitoring

### Check Backup Status

```bash
# List all backups
npm run backup:list

# Check backup directory
ls -lh storage/backups/
```

### PM2 Monitoring

```bash
# Check backup job status
pm2 status
pm2 logs social-auto-backup

# View backup job metrics
pm2 monit
```

### Windows Task Scheduler

```powershell
# View task status
Get-ScheduledTask -TaskName "SocialAuto-Database-Backup"

# View task history
Get-ScheduledTaskInfo -TaskName "SocialAuto-Database-Backup"

# View last run result
Get-ScheduledTaskInfo -TaskName "SocialAuto-Database-Backup" | Select-Object LastRunTime, LastTaskResult
```

## Troubleshooting

### Backup Fails

**Problem**: Backup script fails with error

**Solutions**:
1. Check database file exists: `ls -la storage/app.db`
2. Check disk space: `df -h`
3. Check backup directory permissions: `ls -la storage/backups`
4. Check logs: `pm2 logs social-auto-backup`

### Verification Fails

**Problem**: Backup verification fails with hash mismatch

**Solutions**:
1. Database might be in use during backup
2. Stop worker/api before manual backup
3. Check for database corruption: `sqlite3 storage/app.db "PRAGMA integrity_check;"`

### R2/S3 Upload Fails

**Problem**: Upload to off-site storage fails

**Solutions**:
1. Check AWS CLI is installed: `aws --version`
2. Verify credentials in `.env.local`
3. Test connection: `aws s3 ls s3://your-bucket`
4. Check bucket permissions

### Restore Fails

**Problem**: Restore from backup fails

**Solutions**:
1. Verify backup file exists: `ls -la storage/backups/`
2. Verify backup integrity: `npm run backup:verify <file>`
3. Check disk space
4. Stop worker/api before restore

## Best Practices

1. **Test restores regularly**: Verify your backups work by restoring to a test database
2. **Monitor backup logs**: Check PM2 logs or Task Scheduler history regularly
3. **Off-site storage**: Use R2/S3 for disaster recovery
4. **Retention policy**: Adjust based on your storage capacity and compliance needs
5. **Backup during low usage**: Schedule backups during low-traffic periods
6. **Document restore process**: Keep this documentation accessible for emergencies

## Security Considerations

- **Encrypt R2/S3 credentials**: Never commit `.env.local` to version control
- **Limit backup access**: Restrict who can run backup/restore commands
- **Secure off-site storage**: Use bucket policies and encryption at rest
- **Audit backup access**: Monitor who accesses backup files

## Disaster Recovery

In case of complete system failure:

1. **Recover from off-site storage** (if configured):
```bash
aws s3 cp s3://your-bucket/backup-2025-09-19-02-00-00.db ./
node scripts/backup-db.js --restore backup-2025-09-19-02-00-00.db
```

2. **Recover from local backups**:
```bash
# Copy latest backup from another machine
# Restore using the backup script
node scripts/backup-db.js --restore backup-latest.db
```

3. **Rebuild system**:
   - Install dependencies
   - Configure environment
   - Restore database
   - Restart services

## Integration with CI/CD

Add backup step to your CI/CD pipeline:

```yaml
# Example GitHub Actions step
- name: Database Backup
  run: |
    npm run backup
    # Upload backup artifact
    # Or push to R2/S3
```

## Implementation Notes

### Platform Compatibility

- **Linux/Mac**: Full support including gzip compression
- **Windows**: Full support with compression disabled by default (can be enabled with `BACKUP_COMPRESS=true`)
- **Cross-platform**: Both Node.js and PowerShell scripts provided

### File Formats

- **Unix systems**: `.db.gz` (gzip compressed) or `.db` (uncompressed)
- **Windows**: `.db` (uncompressed) - compression can be enabled but may have compatibility issues

### Current Limitations

- Compression on Windows requires additional setup and may not work reliably
- No built-in encryption for backup files (use R2/S3 encryption or filesystem encryption)
- No incremental backups (full backups only)

## Support

For issues or questions:
1. Check this documentation
2. Review backup logs
3. Test with manual backup first
4. Verify environment configuration