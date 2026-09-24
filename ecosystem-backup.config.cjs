/**
 * PM2 Ecosystem Configuration for Database Backup Job
 * 
 * This configuration runs the database backup script as a scheduled job.
 * Add this to your main PM2 ecosystem or run separately.
 * 
 * Usage:
 *   pm2 start ecosystem-backup.config.cjs
 *   pm2 save
 *   pm2 startup
 * 
 * The backup job will run once per day at 2 AM local time.
 */

const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'social-auto-backup',
      script: path.join(__dirname, 'scripts', 'backup-db.js'),
      // Run once per day at 2 AM using cron pattern
      cron: '0 2 * * *',
      // Alternative: run every 6 hours
      // cron: ‘0 */6 * * *',
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: './storage/app.db',
        BACKUP_DIR: './storage/backups',
        BACKUP_RETENTION_DAYS: '7',
        BACKUP_COMPRESS: 'true',
      },
      
      // Optional: Add R2/S3 credentials if using off-site storage
      // env_production: {
      //   R2_ACCESS_KEY_ID: 'your-access-key',
      //   R2_SECRET_ACCESS_KEY: 'your-secret-key',
      //   R2_BUCKET: 'your-bucket-name',
      //   R2_ENDPOINT: 'https://your-account.r2.cloudflarestorage.com',
      // },
      
      // Logging
      error_file: './logs/backup-error.log',
      out_file: './logs/backup-out.log',
      log_file: './logs/backup-combined.log',
      time: true,
      
      // Restart configuration
      autorestart: false, // Don't auto-restart after successful backup
      watch: false,
      max_memory_restart: '500M',
      
      // Execution configuration
      exec_mode: 'fork',
      instances: 1,
      
      // Windows-specific settings
      windowsHide: true,
    },
  ],
};
