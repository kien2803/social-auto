/**
 * Copyright (c) 2026 Kien Nguyen
 *
 * Licensed under the MIT License. See LICENSE file in the project root.
 */

/**
 * S3/R2 storage backend implementation.
 * Used for SaaS deployments with AWS S3, Cloudflare R2, or other S3-compatible services.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
  type DeleteObjectCommandInput,
  type HeadObjectCommandInput,
  type ListObjectsV2CommandInput,
} from '@aws-sdk/client-s3';
import type {
  StorageBackend,
  StorageConfig,
  StorageItem,
  StorageMetadata,
  StorageUploadOptions,
} from './interface.js';

export class S3Storage implements StorageBackend {
  readonly type = 's3' as const;
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private quota?: StorageConfig['quota'];

  constructor(config: StorageConfig) {
    if (!config.s3) {
      throw new Error('S3Storage requires s3 config');
    }

    const {
      region,
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket,
      prefix = '',
      forcePathStyle = false,
    } = config.s3;

    this.bucket = bucket;
    this.prefix = prefix;
    this.quota = config.quota;

    this.client = new S3Client({
      region: region || 'us-east-1',
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle,
    });
  }

  async initialize(): Promise<void> {
    // Verify bucket exists and is accessible
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.prefix || '', // Check bucket access
        }),
      );
    } catch (error) {
      // If the object doesn't exist, try to list the bucket instead
      try {
        await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: this.prefix,
            MaxKeys: 1,
          }),
        );
      } catch (listError) {
        console.error('[S3Storage] Failed to verify bucket access:', listError);
        throw new Error('Failed to verify S3 bucket access');
      }
    }
  }

  async upload(
    file: Buffer | NodeJS.ReadableStream,
    key: string,
    options?: StorageUploadOptions,
  ): Promise<string> {
    const fullKey = this.resolveKey(key, options?.tenantId);

    // Check quota before upload
    if (this.quota?.enforceQuota && this.quota.maxBytes > 0) {
      const usage = await this.getUsage(options?.tenantId || '');
      const fileSize = Buffer.isBuffer(file) ? file.length : 0;
      if (usage + fileSize > this.quota.maxBytes) {
        throw new Error(`Storage quota exceeded: ${usage + fileSize} bytes > ${this.quota.maxBytes} bytes`);
      }
    }

    const input: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: fullKey,
      Body: file as any, // Type assertion for AWS SDK compatibility
      ContentType: options?.contentType,
      Metadata: options?.metadata,
    };

    await this.client.send(new PutObjectCommand(input));
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const fullKey = this.resolveKey(key);

    const input: GetObjectCommandInput = {
      Bucket: this.bucket,
      Key: fullKey,
    };

    const response = await this.client.send(new GetObjectCommand(input));
    
    if (!response.Body) {
      throw new Error('No body in S3 response');
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    const stream = response.Body as any;
    
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    
    return Buffer.concat(chunks);
  }

  async getPublicUrl(key: string, _expiresIn: number = 3600): Promise<string | null> {
    // For now, return null - would need to implement presigned URLs
    // Could use @aws-sdk/s3-request-presigner
    return null;
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.resolveKey(key);

    const input: DeleteObjectCommandInput = {
      Bucket: this.bucket,
      Key: fullKey,
    };

    await this.client.send(new DeleteObjectCommand(input)).catch(() => {
      // File might not exist, ignore error
    });
  }

  async exists(key: string): Promise<boolean> {
    const fullKey = this.resolveKey(key);

    const input: HeadObjectCommandInput = {
      Bucket: this.bucket,
      Key: fullKey,
    };

    try {
      await this.client.send(new HeadObjectCommand(input));
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    const fullKey = this.resolveKey(key);

    const input: HeadObjectCommandInput = {
      Bucket: this.bucket,
      Key: fullKey,
    };

    try {
      const response = await this.client.send(new HeadObjectCommand(input));
      return {
        size: response.ContentLength || 0,
        lastModified: response.LastModified?.getTime() || 0,
        contentType: response.ContentType,
        etag: response.ETag,
        metadata: response.Metadata,
      };
    } catch {
      return null;
    }
  }

  async list(prefix: string, limit?: number): Promise<StorageItem[]> {
    const fullPrefix = this.resolveKey(prefix);

    const input: ListObjectsV2CommandInput = {
      Bucket: this.bucket,
      Prefix: fullPrefix,
      MaxKeys: limit,
    };

    try {
      const response = await this.client.send(new ListObjectsV2Command(input));
      
      return (response.Contents || []).map((obj) => ({
        key: this.stripPrefix(obj.Key || ''),
        size: obj.Size || 0,
        lastModified: obj.LastModified?.getTime() || 0,
        isDirectory: false, // S3 doesn't have directories, only prefixes
      }));
    } catch {
      return [];
    }
  }

  async getUsage(prefix: string): Promise<number> {
    const fullPrefix = this.resolveKey(prefix);
    let totalSize = 0;
    let continuationToken: string | undefined;

    do {
      const input: ListObjectsV2CommandInput = {
        Bucket: this.bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      };

      const response = await this.client.send(new ListObjectsV2Command(input));
      
      for (const obj of response.Contents || []) {
        totalSize += obj.Size || 0;
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return totalSize;
  }

  async close(): Promise<void> {
    // S3Client doesn't need explicit cleanup
  }

  private resolveKey(key: string, tenantId?: string): string {
    const sanitized = key.replace(/^(\.\.(\/|\\|$))+/, '');
    const parts = [this.prefix];
    
    if (tenantId) {
      parts.push(tenantId);
    }
    
    parts.push(sanitized);
    
    return parts.filter(Boolean).join('/');
  }

  private stripPrefix(key: string): string {
    if (!this.prefix) return key;
    if (key.startsWith(this.prefix + '/')) {
      return key.slice(this.prefix.length + 1);
    }
    return key;
  }
}
