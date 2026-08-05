// apps/web-gov/src/test/safe-next.spec.ts · unit tests for the same-origin return-path guard. The login flow
// and session gate both feed user-controlled `next`/`returnTo` values through safeNext, so open-redirect coverage
// is security-relevant: every absolute or protocol-relative URL must collapse to the safe default.
import { safeNext } from '../features/nav/safe-next';

describe('safeNext', () => {
  it('honours a clean same-origin path', () => {
    expect(safeNext('/listings')).toBe('/listings');
    expect(safeNext('/orders?cursor=abc')).toBe('/orders?cursor=abc');
  });

  it('falls back to /dashboard for empty/missing input', () => {
    expect(safeNext(undefined)).toBe('/dashboard');
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext('')).toBe('/dashboard');
  });

  it('rejects absolute URLs (open-redirect protection)', () => {
    expect(safeNext('https://evil.example/steal')).toBe('/dashboard');
    expect(safeNext('http://evil.example')).toBe('/dashboard');
    expect(safeNext('javascript:alert(1)')).toBe('/dashboard');
  });

  it('rejects protocol-relative //host', () => {
    expect(safeNext('//evil.example/path')).toBe('/dashboard');
  });

  it('honours a custom fallback', () => {
    expect(safeNext('//evil', '/login')).toBe('/login');
    expect(safeNext('/ok', '/login')).toBe('/ok');
  });
});
