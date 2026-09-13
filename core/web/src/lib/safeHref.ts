/**
 * URL safety helpers. Keep user-supplied strings out of dangerous URL
 * contexts (anchor hrefs, iframe src, etc.). A stored "javascript:" or
 * "data:" URL would otherwise execute on click via the browser's URL
 * parser. Only http(s) and protocol-relative `//` schemes are allowed.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Returns a sanitized href string suitable for `<a href={…}>`. If the
 * input is missing, malformed, or uses a non-http(s) protocol, returns
 * `undefined` so the caller can skip rendering the link (or fall back
 * to plain text).
 *
 * `mailto:` is NOT in the allowed set — emails should render as text
 * unless we wire a separate handler. Users who want to follow external
 * links go through normal https.
 */
export function safeHref(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  // Protocol-relative URL like //example.com/path → add https: prefix.
  let candidate = trimmed;
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return undefined;
  return parsed.toString();
}