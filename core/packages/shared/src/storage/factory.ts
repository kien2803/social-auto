/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * Storage backend factory
 * Creates the appropriate storage backend based on configuration
 */

import type { StorageBackend, StorageConfig } from './interface.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';

export function createStorageBackend(config: StorageConfig): StorageBackend {
  switch (config.type) {
    case 'local':
      return new LocalStorage(config);
    
    case 's3':
    case 'r2':
      return new S3Storage(config);
    
    default:
      throw new Error(`Unknown storage type: ${(config as StorageConfig).type}`);
  }
}

/**
 * Create storage backend from environment variables
 */
export function createStorageFromEnv(): StorageBackend {
  const storageType = process.env['STORAGE_TYPE'] as 'local' | 's3' | 'r2' || 'local';
  
  const config: StorageConfig = {
    type: storageType,
  };

  if (storageType === 'local') {
    config.local = {
      baseDir: process.env['STORAGE_DIR'] || './storage',
    };
  } else if (storageType === 's3' || storageType === 'r2') {
    config.s3 = {
      region: process.env['AWS_REGION'] || 'us-east-1',
      endpoint: process.env['AWS_ENDPOINT'] || undefined,
      accessKeyId: process.env['AWS_ACCESS_KEY_ID'] || '',
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
      bucket: process.env['AWS_S3_BUCKET'] || '',
      prefix: process.env['AWS_S3_PREFIX'] || '',
      forcePathStyle: storageType === 'r2' || process.env['AWS_FORCE_PATH_STYLE'] === 'true',
    };
  }

  // Quota configuration
  const quotaGB = Number.parseInt(process.env['STORAGE_QUOTA_GB'] || '10', 10);
  if (quotaGB > 0) {
    config.quota = {
      maxBytes: quotaGB * 1024 * 1024 * 1024,
      enforceQuota: process.env['STORAGE_ENFORCE_QUOTA'] !== 'false',
    };
  }

  return createStorageBackend(config);
}
