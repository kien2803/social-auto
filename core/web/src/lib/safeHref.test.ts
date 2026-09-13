import { describe, it, expect } from 'vitest';
import { safeHref } from './safeHref.js';

describe('safeHref', () => {
  it('returns undefined for empty / whitespace / nullish input', () => {
    expect(safeHref('')).toBeUndefined();
    expect(safeHref('   ')).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });

  it('accepts http and https URLs', () => {
    expect(safeHref('https://example.com/page')).toBe('https://example.com/page');
    expect(safeHref('http://example.com/page')).toBe('http://example.com/page');
  });

  it('rejects javascript: URLs (XSS)', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('JavaScript:alert(1)')).toBeUndefined();
  });

  it('rejects data: URLs', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });

  it('rejects vbscript: and other dangerous protocols', () => {
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
    expect(safeHref('file:///etc/passwd')).toBeUndefined();
  });

  it('rejects mailto: (out of scope for external link chips)', () => {
    expect(safeHref('mailto:user@example.com')).toBeUndefined();
  });

  it('rejects unparseable strings', () => {
    expect(safeHref('not a url at all')).toBeUndefined();
    expect(safeHref('://missing-scheme')).toBeUndefined();
  });

  it('upgrades protocol-relative URLs to https', () => {
    expect(safeHref('//example.com/path')).toBe('https://example.com/path');
  });

  it('trims surrounding whitespace before validating', () => {
    expect(safeHref('  https://example.com  ')).toBe('https://example.com/');
  });
});