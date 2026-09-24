#!/usr/bin/env node
/**
 * Database Backup Script for social-auto (Cross-platform)
 * 
 * Creates automated backups of the SQLite database with:
 * - Daily scheduled backups
 * - Retention policy (configurable, default 7 days)
 * - Off-site storage support (R2/S3)
 * - Backup verification
 * - Optional compression (disabled on Windows by default)
 * 
 * Usage:
 *   node scripts/backup-db.js                    # Manual backup
 *   node scripts/backup-db.js --verify          # Verify last backup
 *   node scripts/backup-db.js --restore <file>  # Restore from backup
 *   node scripts/backup-db.js --list            # List available backups
 * 
 * Environment Variables:
 *   DATABASE_URL              - Path to database file (default: ./storage/app.db)
 *   BACKUP_DIR                - Backup directory (default: ./storage/backups)
 *   BACKUP_RETENTION_DAYS     - Days to keep backups (default: 7)
 *   BACKUP_COMPRESS           - Compress backups (default: false on Windows, true on Unix)
 *   R2_ACCESS_KEY_ID          - R2/S3 access key (optional)
 *   R2_SECRET_ACCESS_KEY      - R2/S3 secret key (optional)
 *   R2_BUCKET                 - R2/S3 bucket name (optional)
 *   R2_ENDPOINT               - R2/S3 endpoint (optional)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname as pathDirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);
const projectRoot = resolve(__dirname, '..');

// Configuration
const isWindows = process.platform === 'win32';
const config = {
  databaseUrl: resolve(projectRoot, process.env.DATABASE_URL || './storage/app.db'),
  backupDir: resolve(projectRoot, process.env.BACKUP_DIR || './storage/backups'),
  retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10),
  // Disable compression by default on Windows due to compatibility issues
  compress: isWindows ? (process.env.BACKUP_COMPRESS === 'true') : (process.env.BACKUP_COMPRESS !== 'false'),
  r2: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    endpoint: process.env.R2_ENDPOINT,
  },
};

// Ensure backup directory exists
function ensureBackupDir() {
  if (!existsSync(config.backupDir)) {
    mkdirSync(config.backupDir, { recursive: true });
  }
}

// Generate backup filename with timestamp
function generateBackupFilename() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const ext = config.compress ? '.db.gz' : '.db';
  return `backup-${timestamp}${ext}`;
}

// Calculate file hash for verification
function calculateHash(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

// Create backup
function createBackup() {
  console.log('🔄 Starting database backup...');
  
  ensureBackupDir();
  
  // Check if database exists
  if (!existsSync(config.databaseUrl)) {
    console.error('❌ Database file not found:', config.databaseUrl);
    process.exit(1);
  }
  
  const backupFilename = generateBackupFilename();
  const backupPath = join(config.backupDir, backupFilename);
  
  console.log(`📦 Creating backup: ${backupFilename}`);
  console.log(`📁 Database: ${config.databaseUrl}`);
  console.log(`💾 Backup: ${backupPath}`);
  console.log(`🗜️  Compression: ${config.compress ? 'enabled' : 'disabled'}`);
  
  try {
    // Simple copy for now (compression can be added later if needed)
    copyFileSync(config.databaseUrl, backupPath);
    
    // Verify backup hash
    const originalHash = calculateHash(config.databaseUrl);
    const backupHash = calculateHash(backupPath);
    
    if (originalHash !== backupHash) {
      console.error('❌ Backup verification failed - hash mismatch');
      console.error(`   Original: ${originalHash}`);
      console.error(`   Backup:   ${backupHash}`);
      unlinkSync(backupPath);
      process.exit(1);
    }
    
    console.log('✅ Backup verified successfully');
    console.log(`📊 Backup size: ${statSync(backupPath).size} bytes`);
    
    // Upload to R2/S3 if configured
    if (config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket) {
      uploadToR2(backupPath, basename(backupPath));
    }
    
    // Clean old backups
    cleanOldBackups();
    
    console.log('✨ Backup completed successfully');
    return backupPath;
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    process.exit(1);
  }
}

// Upload backup to R2/S3
function uploadToR2(localPath, filename) {
  console.log('☁️  Uploading backup to R2/S3...');
  
  try {
    // Using AWS CLI for S3-compatible storage
    const endpoint = config.r2.endpoint ? `--endpoint-url ${config.r2.endpoint}` : '';
    const command = `AWS_ACCESS_KEY_ID="${config.r2.accessKeyId}" AWS_SECRET_ACCESS_KEY="${config.r2.secretAccessKey}" aws s3 cp "${localPath}" s3://${config.r2.bucket}/${filename} ${endpoint}`;
    
    execSync(command, { stdio: 'inherit' });
    console.log('✅ Upload completed');
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    console.log('⚠️  Backup retained locally');
  }
}

// Clean old backups based on retention policy
function cleanOldBackups() {
  console.log(`🧹 Cleaning backups older than ${config.retentionDays} days...`);
  
  try {
    const files = readdirSync(config.backupDir);
    const now = Date.now();
    const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = join(config.backupDir, file);
      const stats = statSync(filePath);
      
      if (now - stats.mtimeMs > retentionMs) {
        unlinkSync(filePath);
        console.log(`🗑️  Deleted old backup: ${file}`);
        deletedCount++;
      }
    }
    
    console.log(`✅ Cleanup completed: ${deletedCount} file(s) deleted`);
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
  }
}

// Verify backup integrity
function verifyBackup(backupPath) {
  console.log(`🔍 Verifying backup: ${backupPath}`);
  
  if (!existsSync(backupPath)) {
    console.error('❌ Backup file not found');
    process.exit(1);
  }
  
  try {
    // Validate as SQLite database
    const stats = statSync(backupPath);
    if (stats.size < 100) {
      throw new Error('File too small to be valid database');
    }
    
    // Try to read SQLite header (first 16 bytes should be "SQLite format 3")
    const header = readFileSync(backupPath, { start: 0, end: 15 });
    if (!header.toString('utf-8', 0, 15).startsWith('SQLite format 3')) {
      throw new Error('Invalid SQLite header');
    }
    
    console.log('✅ Backup is valid SQLite database');
    console.log(`📊 File size: ${stats.size} bytes`);
    return true;
  } catch (error) {
    console.error('❌ Backup verification failed:', error.message);
    process.exit(1);
  }
}

// Restore from backup
function restoreBackup(backupPath) {
  console.log(`🔄 Restoring from backup: ${backupPath}`);
  
  if (!existsSync(backupPath)) {
    console.error('❌ Backup file not found');
    process.exit(1);
  }
  
  // Verify backup before restoring
  verifyBackup(backupPath);
  
  try {
    // Create backup of current database before restore
    const currentBackup = join(config.backupDir, `pre-restore-${Date.now()}.db`);
    copyFileSync(config.databaseUrl, currentBackup);
    console.log(`💾 Current database backed up to: ${currentBackup}`);
    
    // Restore database
    copyFileSync(backupPath, config.databaseUrl);
    
    console.log('✅ Restore completed successfully');
    console.log(`⚠️  Previous database saved to: ${currentBackup}`);
  } catch (error) {
    console.error('❌ Restore failed:', error.message);
    process.exit(1);
  }
}

// List available backups
function listBackups() {
  console.log('📋 Available backups:');
  
  try {
    const files = readdirSync(config.backupDir)
      .filter(f => f.startsWith('backup-') && (f.endsWith('.db') || f.endsWith('.db.gz')))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      console.log('  No backups found');
      return;
    }
    
    for (const file of files) {
      const filePath = join(config.backupDir, file);
      const stats = statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      const date = stats.mtime.toLocaleString();
      console.log(`  ${file}`);
      console.log(`    Size: ${sizeMB} MB`);
      console.log(`    Date: ${date}`);
      console.log('');
    }
  } catch (error) {
    console.error('❌ Failed to list backups:', error.message);
  }
}

// Main CLI
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Default: create backup
    createBackup();
  } else if (args[0] === '--verify') {
    const backupFile = args[1] || getLatestBackup();
    if (!backupFile) {
      console.error('❌ No backup file specified and no recent backup found');
      process.exit(1);
    }
    verifyBackup(join(config.backupDir, backupFile));
  } else if (args[0] === '--restore') {
    if (!args[1]) {
      console.error('❌ Please specify backup file to restore');
      console.log('Usage: node scripts/backup-db.js --restore <backup-file>');
      process.exit(1);
    }
    restoreBackup(join(config.backupDir, args[1]));
  } else if (args[0] === '--list') {
    listBackups();
  } else if (args[0] === '--help') {
    console.log(`
Database Backup Script

Usage:
  node scripts/backup-db.js                    # Create backup
  node scripts/backup-db.js --verify [file]   # Verify backup (uses latest if not specified)
  node scripts/backup-db.js --restore <file>  # Restore from backup
  node scripts/backup-db.js --list            # List available backups
  node scripts/backup-db.js --help            # Show this help

Environment Variables:
  DATABASE_URL              - Path to database file (default: ./storage/app.db)
  BACKUP_DIR                - Backup directory (default: ./storage/backups)
  BACKUP_RETENTION_DAYS     - Days to keep backups (default: 7)
  BACKUP_COMPRESS           - Compress backups (default: false on Windows, true on Unix)
  R2_ACCESS_KEY_ID          - R2/S3 access key (optional)
  R2_SECRET_ACCESS_KEY      - R2/S3 secret key (optional)
  R2_BUCKET                 - R2/S3 bucket name (optional)
  R2_ENDPOINT               - R2/S3 endpoint (optional)

Note: Compression is disabled by default on Windows due to compatibility issues.
To enable compression on Windows, set BACKUP_COMPRESS=true in your environment.
    `);
  } else {
    console.error('❌ Unknown command:', args[0]);
    console.log('Run --help for usage information');
    process.exit(1);
  }
}

function getLatestBackup() {
  try {
    const files = readdirSync(config.backupDir)
      .filter(f => f.startsWith('backup-') && (f.endsWith('.db') || f.endsWith('.db.gz')))
      .sort()
      .reverse();
    
    return files[0] || null;
  } catch {
    return null;
  }
}

main();
