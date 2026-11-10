// apps/web-gov/src/test/gov1-sources.fixture.ts · PC-56 GOV-1a — reads `const|export const LANG_COOKIE = '<name>'` out of a source file (the
// middleware cannot import lib/i18n.ts, a server-only module, so the two are compared as text).
export const LANG_COOKIE_FOR_TEST = (src: string): string | null => (/LANG_COOKIE\s*=\s*'([^']+)'/.exec(src) ?? [])[1] ?? null;
