/**
 * Typed re-export surface for AES helpers. The implementation in
 * `./crypto.ts` uses Node-only APIs (`node:crypto`) and must NEVER reach
 * the web bundle. Node-side consumers (api, worker, scripts) keep their
 * existing import path via the runtime export below; type-only consumers
 * pull from this file so no Node runtime is dragged into the browser.
 */
export type EncryptionKey = string;
