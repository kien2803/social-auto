/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * Storage backend abstraction for self-hosted (local filesystem) and SaaS (S3/R2) modes.
 * All storage operations should go through this interface to enable easy backend swapping.
 */

export interface StorageBackend {
  /**
   * Unique identifier for this storage backend
   */
  readonly type: 'local' | 's3' | 'r2';

  /**
   * Upload a file to storage
   * @param file - File buffer or stream
   * @param key - Storage key (relative path within storage namespace)
   * @param options - Optional metadata and options
   * @returns Storage key or public URL
   */
  upload(
    file: Buffer | NodeJS.ReadableStream,
    key: string,
    options?: StorageUploadOptions,
  ): Promise<string>;

  /**
   * Download a file from storage
   * @param key - Storage key
   * @returns File buffer
   */
  download(key: string): Promise<Buffer>;

  /**
   * Get a public URL for a file (if supported by backend)
   * @param key - Storage key
   * @param expiresIn - URL expiration in seconds (for signed URLs)
   * @returns Public URL or null if not supported
   */
  getPublicUrl(key: string, expiresIn?: number): Promise<string | null>;

  /**
   * Delete a file from storage
   * @param key - Storage key
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists
   * @param key - Storage key
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get file metadata (size, last modified, etc.)
   * @param key - Storage key
   */
  getMetadata(key: string): Promise<StorageMetadata | null>;

  /**
   * List files in a directory/prefix
   * @param prefix - Storage prefix
   * @param limit - Maximum number of results
   */
  list(prefix: string, limit?: number): Promise<StorageItem[]>;

  /**
   * Get total storage usage for a namespace/tenant
   * @param prefix - Storage prefix to calculate usage for
   */
  getUsage(prefix: string): Promise<number>;

  /**
   * Initialize storage backend (create directories, buckets, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Cleanup resources (close connections, etc.)
   */
  close(): Promise<void>;
}

export interface StorageUploadOptions {
  /**
   * Content type (MIME type)
   */
  contentType?: string;

  /**
   * Custom metadata
   */
  metadata?: Record<string, string>;

  /**
   * Whether to make the file publicly accessible
   */
  public?: boolean;

  /**
   * Tenant ID for multi-tenant isolation
   */
  tenantId?: string;
}

export interface StorageMetadata {
  /**
   * File size in bytes
   */
  size: number;

  /**
   * Last modified timestamp (unix ms)
   */
  lastModified: number;

  /**
   * Content type (MIME type)
   */
  contentType?: string;

  /**
   * ETag or hash identifier
   */
  etag?: string;

  /**
   * Custom metadata
   */
  metadata?: Record<string, string>;
}

export interface StorageItem {
  /**
   * Storage key
   */
  key: string;

  /**
   * File size in bytes
   */
  size: number;

  /**
   * Last modified timestamp (unix ms)
   */
  lastModified: number;

  /**
   * Whether this is a directory (prefix)
   */
  isDirectory: boolean;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /**
   * Storage backend type
   */
  type: 'local' | 's3' | 'r2';

  /**
   * Local storage configuration
   */
  local?: {
    /**
     * Base directory for local storage
     */
    baseDir: string;
  };

  /**
   * S3/R2 configuration
   */
  s3?: {
    /**
     * AWS region (for S3) or endpoint (for R2)
     */
    region?: string;

    /**
     * Custom endpoint (for R2 or other S3-compatible services)
     */
    endpoint?: string;

    /**
     * Access key ID
     */
    accessKeyId: string;

    /**
     * Secret access key
     */
    secretAccessKey: string;

    /**
     * Bucket name
     */
    bucket: string;

    /**
     * Path prefix for all objects (for multi-tenant isolation)
     */
    prefix?: string;

    /**
     * Force path style (for R2 and minio)
     */
    forcePathStyle?: boolean;
  };

  /**
   * Quota settings
   */
  quota?: {
    /**
     * Maximum storage in bytes (0 = unlimited)
     */
    maxBytes: number;

    /**
     * Check quota before upload
     */
    enforceQuota: boolean;
  };
}
