// apps/web-tenant/src/features/webhooks/headers.ts · PC-56 TENANT-13a (F-5) · the response headers a page that can hold a signing secret
// is served with. Pure (the Edge middleware imports it). The developer webhook pages show a secret ONCE, in memory; this keeps that
// screen out of every cache (browser back-forward cache included: no-store) and stops the next navigation from carrying its address in
// a Referer. next.config.js sets the same pair for the same paths; both are pinned by src/test/tenant13a-webhooks.spec.ts.
export const SECRET_PAGE_PREFIX = '/settings/developers/webhooks';
export const SECRET_PAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
});

/** PC-56 TENANT-13c: the WHOLE developer area (an API key is shown once on /settings/developers) and the integrations pages (a provider
 *  credential is typed there) carry the same pair. The webhook prefix stays listed for the 13a pin. */
export const SECRET_PAGE_PREFIXES: readonly string[] = Object.freeze([SECRET_PAGE_PREFIX, '/settings/developers', '/settings/integrations']);

export function secretPageHeaders(pathname: string): Record<string, string> {
  const p = String(pathname ?? '');
  return SECRET_PAGE_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`)) ? { ...SECRET_PAGE_HEADERS } : {};
}
