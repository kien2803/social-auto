/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0.
 *
 * Required by TikTok and recommended for all public OAuth clients to prevent
 * authorization code interception attacks.
 *
 * Flow:
 *   1. Generate random code_verifier (32 bytes, base64url encoded)
 *   2. Hash it with SHA-256 and base64url encode to get code_challenge
 *   3. Send code_challenge in /auth/start request to OAuth provider
 *   4. Store code_verifier in session/cookie
 *   5. Provider redirects back with code
 *   6. Exchange code + code_verifier for tokens
 */
import { createHash, randomBytes } from 'node:crypto';

export interface PKCEPair {
  /** Random 32-byte string, base64url encoded. Store securely for callback. */
  verifier: string;
  /** SHA-256 hash of verifier, base64url encoded. Send to OAuth provider. */
  challenge: string;
}

/**
 * Generate a PKCE verifier/challenge pair using the S256 method.
 */
export function generatePKCE(): PKCEPair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
