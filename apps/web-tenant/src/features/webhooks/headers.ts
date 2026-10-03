// apps/web-tenant/src/features/webhooks/headers.ts · PC-56 TENANT-13a (F-5) · the response headers a page that can hold a signing secret
// is served with. Pure (the Edge middleware imports it). The developer webhook pages show a secret ONCE, in memory; this keeps that
// screen out of every cache (browser back-forward cache included: no-store) and stops the next navigation from carrying its address in
// a Referer. next.config.js sets the same pair for the same paths; both are pinned by src/test/tenant13a-webhooks.spec.ts.
export const SECRET_PAGE_PREFIX = '/settings/developers/webhooks';
export const SECRET_PAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
});

export function secretPageHeaders(pathname: string): Record<string, string> {
  const p = String(pathname ?? '');
  return p === SECRET_PAGE_PREFIX || p.startsWith(`${SECRET_PAGE_PREFIX}/`) ? { ...SECRET_PAGE_HEADERS } : {};
}
