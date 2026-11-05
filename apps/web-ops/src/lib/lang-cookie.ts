// apps/web-ops/src/lib/lang-cookie.ts · PC-56 HOTFIX-10 · H10-4 (survey OPS-1 F-20 / C-10) — THE ONE DEFINITION of the console's language cookie.
// Framework-free on purpose: the Edge middleware, the server i18n helper (`lib/i18n.ts`, server-only), the `/api/lang` switcher route and the
// client error boundary all import THIS constant. The middleware used to hold its own copy, copied from web-tenant (`kvt_lang`), so a `?lang=`
// choice was written into a cookie this console never reads.
export const LANG_COOKIE = 'kvo_lang';
