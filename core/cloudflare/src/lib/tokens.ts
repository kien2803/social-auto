import type { Env } from '../env';
import type { AccountsRepo } from '../repos/accounts';
import type { AccountRow } from '../repos/types';
import { decrypt, encrypt } from './crypto';
import { refreshAccessToken } from './google';
import { refreshTiktokAccessToken } from './tiktok';

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

/**
 * Decrypt the account's access token, refreshing via its refresh token
 * when it has expired (or is inside the 60s skew buffer).
 *
 * Per-platform behaviour:
 *   youtube   — Google OAuth refresh grant; refresh token unchanged.
 *   tiktok    — Login Kit refresh grant; TikTok ROTATES the refresh token,
 *               so the new value is persisted alongside the access token.
 *   facebook / instagram — Meta page tokens carry a long expiry (~60d) and
 *               have no refresh grant; an expired token throws so the
 *               caller can surface 'reconnect' instead of looping.
 *
 * Throws 'token_refresh_failed' on any refresh failure.
 */
export async function usableAccessToken(env: Env, accounts: AccountsRepo, row: AccountRow): Promise<string> {
  if (row.oauth_access_token && row.token_expires_at && row.token_expires_at > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    try {
      return await decrypt(row.oauth_access_token, env.TOKEN_ENCRYPTION_KEY);
    } catch {
      /* fall through to refresh */
    }
  }
  // A stored access token with no recorded expiry — Meta rows created
  // before token_expires_at was tracked. Use it until the API says no.
  if (row.oauth_access_token && !row.token_expires_at) {
    try {
      return await decrypt(row.oauth_access_token, env.TOKEN_ENCRYPTION_KEY);
    } catch {
      /* fall through */
    }
  }
  // A refresh token we can't decrypt is a broken grant — same outcome as a
  // revoked one: the account must be reconnected.
  let refresh: string;
  try {
    refresh = await decrypt(row.oauth_refresh_token, env.TOKEN_ENCRYPTION_KEY);
  } catch {
    throw new Error('token_refresh_failed: stored refresh token unreadable — reconnect account');
  }
  let tokens: { access_token: string; expires_at: number; refresh_token?: string };
  if (row.platform === 'youtube') {
    tokens = await refreshAccessToken(env, refresh).catch((e) => {
      throw new Error(`token_refresh_failed: ${e instanceof Error ? e.message : e}`);
    });
  } else if (row.platform === 'tiktok') {
    tokens = await refreshTiktokAccessToken(env, refresh);
  } else {
    // Meta: oauth_refresh_token is a placeholder ('meta-refresh-*') — page
    // tokens can't be refreshed via OAuth, the user must reconnect.
    throw new Error('token_refresh_failed: meta token expired — reconnect account');
  }
  await accounts.updateTokens(row.id, {
    access_token: await encrypt(tokens.access_token, env.TOKEN_ENCRYPTION_KEY),
    refresh_token: tokens.refresh_token
      ? await encrypt(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY)
      : undefined,
    expires_at: tokens.expires_at,
  });
  return tokens.access_token;
}
