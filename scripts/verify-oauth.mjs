#!/usr/bin/env node
/**
 * Verify the OAuth /auth/<platform>/start endpoints on the running API.
 * Prints one line per platform with:
 *   - the actual redirect URL we send
 *   - the host it points to (Google / TikTok / Facebook / mock)
 *   - whether the mode is REAL or MOCK (based on the URL host + path)
 *   - any mismatch vs the configured WEB_ORIGIN / *_REDIRECT_URI
 *
 * Usage (run from any directory):
 *   API_BASE=http://localhost:5182 node scripts/verify-oauth.mjs
 *
 * Default API_BASE is http://localhost:5182.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:5182';
const API_BASE_URL = new URL(API_BASE);

const PLATFORMS = [
  { name: 'YouTube', path: '/auth/youtube/start' },
  { name: 'TikTok', path: '/auth/tiktok/start' },
  { name: 'Instagram (legacy mock)', path: '/auth/instagram/start', mockPlatform: 'instagram' },
  { name: 'Facebook (legacy mock)', path: '/auth/facebook/start', mockPlatform: 'facebook' },
  { name: 'Meta (real)', path: '/auth/meta/start' },
];

function classify(redirectUrl) {
  try {
    // The API may emit a relative Location (e.g. "/auth/instagram/callback?code=…")
    // for mock-mode redirects. Resolve against the API base first.
    const absolute = new URL(redirectUrl, API_BASE).toString();
    const u = new URL(absolute);
    return { host: u.host, path: u.pathname, params: Object.fromEntries(u.searchParams), absolute };
  } catch {
    return { host: '?', path: '?', params: {}, absolute: redirectUrl };
  }
}

function checkYouTube(info) {
  const issues = [];
  if (info.host !== 'accounts.google.com') issues.push(`host should be accounts.google.com (got ${info.host})`);
  if (info.params.response_type !== 'code') issues.push('response_type=code missing');
  if (!info.params.client_id) issues.push('client_id missing');
  if (!info.params.redirect_uri) issues.push('redirect_uri missing');
  if (!info.params.scope) issues.push('scope missing');
  if (!info.params.state) issues.push('state missing');
  return issues;
}

function checkTikTok(info) {
  const issues = [];
  if (info.host !== 'www.tiktok.com') issues.push(`host should be www.tiktok.com (got ${info.host})`);
  if (info.params.response_type !== 'code') issues.push('response_type=code missing');
  if (!info.params.client_key) issues.push('client_key missing');
  if (!info.params.redirect_uri) issues.push('redirect_uri missing');
  if (!info.params.code_challenge) issues.push('code_challenge (PKCE) missing');
  if (info.params.code_challenge_method !== 'S256') issues.push('code_challenge_method must be S256');
  return issues;
}

function checkMeta(info) {
  const issues = [];
  const isReal = info.host.endsWith('facebook.com') && info.path.includes('/dialog/oauth');
  if (!isReal) {
    issues.push(`host ${info.host}${info.path} is not facebook.com/<api>/dialog/oauth — meta factory probably auto-fell-back to mock (empty META_APP_ID/SECRET)`);
    return { issues, isReal: false };
  }
  if (!info.params.client_id) issues.push('client_id missing');
  if (!info.params.redirect_uri) issues.push('redirect_uri missing');
  if (!info.params.state) issues.push('state missing');
  if (!info.params.scope) issues.push('scope missing');
  return { issues, isReal: true };
}

function checkLegacyMock(info, platform) {
  const issues = [];
  if (info.host !== API_BASE_URL.host) {
    issues.push(`host ${info.host} should be ${API_BASE_URL.host}`);
  }
  if (!info.path.includes(`/auth/${platform}/callback`)) {
    issues.push(`path ${info.path} should include /auth/${platform}/callback`);
  }
  if (!info.params.code || !info.params.code.startsWith(`${platform}-`)) {
    issues.push(`code query param should start with "${platform}-"`);
  }
  return issues;
}

async function checkOne(platform) {
  let res;
  try {
    res = await fetch(`${API_BASE}${platform.path}`, { redirect: 'manual' });
  } catch (err) {
    return { ok: false, error: `connection failed: ${err.message}` };
  }
  if (res.status !== 302) {
    return { ok: false, error: `expected HTTP 302, got ${res.status}` };
  }
  const loc = res.headers.get('location');
  if (!loc) return { ok: false, error: 'no Location header' };
  const info = classify(loc);

  let issues = [];
  let mode = 'UNKNOWN';
  if (platform.name === 'YouTube') {
    issues = checkYouTube(info);
    mode = 'REAL';
  } else if (platform.name === 'TikTok') {
    issues = checkTikTok(info);
    mode = 'REAL';
  } else if (platform.mockPlatform) {
    issues = checkLegacyMock(info, platform.mockPlatform);
    mode = 'MOCK';
  } else if (platform.name.startsWith('Meta')) {
    const { issues: metaIssues, isReal } = checkMeta(info);
    issues = metaIssues;
    mode = isReal ? 'REAL' : 'MOCK (factory fallback — META_APP_ID or META_APP_SECRET empty in .env.local)';
  }

  return { ok: issues.length === 0, mode, issues, location: loc, info };
}

async function main() {
  console.log(`\nVerifying OAuth endpoints on ${API_BASE}\n`);
  console.log('─'.repeat(78));

  let allOk = true;
  for (const platform of PLATFORMS) {
    const result = await checkOne(platform);
    if (result.error) {
      console.log(`✗ ${platform.name.padEnd(28)} ERROR: ${result.error}`);
      allOk = false;
      continue;
    }
    const status = result.ok ? '✓' : '⚠';
    const mode = result.mode.padEnd(50);
    console.log(`${status} ${platform.name.padEnd(28)} ${mode}`);
    if (result.ok) {
      const summary = `${result.info.host}${result.info.path}`;
      console.log(`  → ${summary}${result.info.params.response_type ? '  (response_type=' + result.info.params.response_type + ')' : ''}`);
    } else {
      for (const issue of result.issues) {
        console.log(`    - ${issue}`);
      }
      allOk = false;
    }
  }

  console.log('─'.repeat(78));
  console.log(allOk ? '\nAll checks passed.\n' : '\nSome checks failed — see warnings above.\n');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
