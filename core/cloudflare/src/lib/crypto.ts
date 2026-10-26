/**
 * WebCrypto AES-256-GCM — wire format identical to the Node version
 * (iv:tag:ciphertext, all hex) so tokens encrypted by either runtime
 * decrypt in the other. Same 12-byte IV, same 32-byte key.
 */

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(keyHex);
  if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(plaintext: string, keyHex: string): Promise<string> {
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  // WebCrypto appends the 16-byte tag to the ciphertext — split it off to
  // match the Node wire format (iv:tag:ct).
  const ct = new Uint8Array(buf);
  const tag = ct.slice(ct.length - 16);
  const enc = ct.slice(0, ct.length - 16);
  return `${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(enc)}`;
}

export async function decrypt(payload: string, keyHex: string): Promise<string> {
  const key = await importKey(keyHex);
  const [ivHex, tagHex, encHex] = payload.split(':');
  if (!ivHex || !tagHex || !encHex) throw new Error('Invalid encrypted payload format');
  // Re-attach tag for WebCrypto.
  const enc = hexToBytes(encHex);
  const tag = hexToBytes(tagHex);
  const ct = new Uint8Array(enc.length + tag.length);
  ct.set(enc);
  ct.set(tag, enc.length);
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(ivHex) },
    key,
    ct,
  );
  return new TextDecoder().decode(buf);
}
