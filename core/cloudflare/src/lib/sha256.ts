/**
 * Incremental SHA-256 for streaming request bodies.
 *
 * `crypto.subtle.digest` is one-shot — it needs the whole input buffered,
 * which defeats streaming uploads (a large video would have to sit in
 * isolate memory). This implements FIPS 180-4 SHA-256 over chunked input:
 * feed Uint8Array chunks to update(), call hex() once at the end.
 *
 * Verified against the standard test vectors:
 *   ""        → e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
 *   "abc"     → ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export class Sha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private bytes = 0;
  private w = new Uint32Array(64);
  private finished = false;

  get size(): number {
    return this.bytes;
  }

  update(chunk: Uint8Array): void {
    if (this.finished) throw new Error('sha256: update after hex()');
    this.bytes += chunk.length;
    this.feed(chunk);
  }

  private feed(chunk: Uint8Array): void {
    let off = 0;
    // Top up the 64-byte block buffer and compress full blocks.
    while (off < chunk.length) {
      const take = Math.min(64 - this.bufLen, chunk.length - off);
      this.buf.set(chunk.subarray(off, off + take), this.bufLen);
      this.bufLen += take;
      off += take;
      if (this.bufLen === 64) {
        this.compress(this.buf);
        this.bufLen = 0;
      }
    }
  }

  private compress(block: Uint8Array): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = i * 4;
      w[i] = (block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d! + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    this.h[0] = (this.h[0]! + a!) | 0;
    this.h[1] = (this.h[1]! + b!) | 0;
    this.h[2] = (this.h[2]! + c!) | 0;
    this.h[3] = (this.h[3]! + d!) | 0;
    this.h[4] = (this.h[4]! + e!) | 0;
    this.h[5] = (this.h[5]! + f!) | 0;
    this.h[6] = (this.h[6]! + g!) | 0;
    this.h[7] = (this.h[7]! + h!) | 0;
  }

  /** Final digest as lowercase hex. Consumes the hasher. */
  hex(): string {
    if (!this.finished) {
      this.finished = true;
      // Pad: 0x80, zeros to byte 56, then 64-bit big-endian bit length.
      const bitLen = this.bytes * 8;
      this.feed(new Uint8Array([0x80]));
      while (this.bufLen !== 56) this.feed(new Uint8Array([0]));
      const tail = new Uint8Array(8);
      const dv = new DataView(tail.buffer);
      dv.setUint32(0, Math.floor(bitLen / 0x100000000));
      dv.setUint32(4, bitLen >>> 0);
      this.feed(tail);
    }
    let out = '';
    for (const v of this.h) out += (v >>> 0).toString(16).padStart(8, '0');
    return out;
  }
}

/**
 * Pump a ReadableStream through the hasher. Returns the hex digest, total
 * byte count, and the first `headBytes` of the stream (for magic-byte
 * sniffing) — all in a single pass.
 */
export async function hashStream(
  stream: ReadableStream<Uint8Array>,
  headBytes = 64,
): Promise<{ sha256: string; size: number; head: Uint8Array }> {
  const hasher = new Sha256();
  const head = new Uint8Array(headBytes);
  let headLen = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) {
        hasher.update(value);
        if (headLen < headBytes) {
          const take = Math.min(headBytes - headLen, value.length);
          head.set(value.subarray(0, take), headLen);
          headLen += take;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { sha256: hasher.hex(), size: hasher.size, head: head.subarray(0, headLen) };
}
