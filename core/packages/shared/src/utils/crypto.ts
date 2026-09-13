import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 * Key is a 32-byte hex string from TOKEN_ENCRYPTION_KEY env var.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard

function getKey(hex: string | undefined): Buffer {
  if (!hex) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return key;
}

/**
 * Encrypt plaintext. Output format: <iv-hex>:<tag-hex>:<ciphertext-hex>
 */
export function encrypt(plaintext: string, keyHex: string | undefined): string {
  const key = getKey(keyHex);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt ciphertext produced by encrypt().
 */
export function decrypt(payload: string, keyHex: string | undefined): string {
  const key = getKey(keyHex);
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivHex, tagHex, encHex] = parts;
  if (!ivHex || !tagHex || !encHex) {
    throw new Error('Invalid encrypted payload parts');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}