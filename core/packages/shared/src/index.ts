/**
 * @social-auto/shared
 * Shared types and DB schema for social-auto.
 *
 * Browser-safe barrel: types + DB schema constants only. Server-side code
 * (api, worker, scripts) that needs AES helpers imports them directly from
 * `utils/crypto.js` so Vite never bundles `node:crypto` into the SPA.
 */
export * from './types/platform.js';
export * from './types/account.js';
export * from './types/publisher.js';
export * from './types/oAuthPopup.js';
export type { EncryptionKey } from './utils/crypto-types.js';
export * from './db/schema.js';
