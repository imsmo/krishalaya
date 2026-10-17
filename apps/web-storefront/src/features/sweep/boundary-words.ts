// apps/web-storefront/src/features/sweep/boundary-words.ts · PC-56 STORE-SWEEP-b · C1 (founder D4 — canon W316) — THE BOUNDARIES' WORDS. PURE (the
// catalogues are plain objects), so a CLIENT boundary (`error.tsx`, `global-error.tsx` — Next requires them to be client components, which cannot
// call the server translator) and a server one read the same sentences.
//
// Every error answers W316's three questions in order: WHAT HAPPENED (`what`) · IS MY STUFF SAFE (`safe` — nothing was charged / nothing was lost)
// · WHAT DO I DO NOW (`now` + the links). The code is small print for support, never the message. No "Oops", no exclamation mark
// (test/sweep-b.spec.ts guards every `*.err.*` / `*.failed.*` / `*.error*` value). Under a store the words name the ORGANISATION and its home
// (`/<slug>`); on the platform, the bazaar and `/`.
import { resolveLanguage } from '@krishalaya/i18n';
import { en } from '../../i18n/en';
import { hi } from '../../i18n/hi';
import { gu } from '../../i18n/gu';

const CATALOGS: Record<string, Record<string, string>> = { en, hi, gu };

export type BoundaryKind = 'not_found' | 'error';
export interface BoundaryStore { slug: string; name: string }
export interface BoundaryWords {
  title: string; what: string; safe: string; now: string; back: string; backHref: string;
  retry: string; orders: string; ordersHref: string; code: string | null;
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{([a-zA-Z]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
export function boundaryText(lang: string | null | undefined, key: string, vars: Record<string, string> = {}): string {
  const code = resolveLanguage(lang || undefined).code;
  return fill(CATALOGS[code]?.[key] ?? en[key] ?? key, vars);
}

/** The words of one boundary, in `lang`, under a store (`store`) or on the platform (null). `code` = the status / digest for support. */
export function boundaryWords(kind: BoundaryKind, store: BoundaryStore | null, lang: string | null | undefined, code?: string | null): BoundaryWords {
  const w = (k: string, v: Record<string, string> = {}) => boundaryText(lang, k, v);
  const org: Record<string, string> = store ? { org: store.name } : {};
  const home = store ? `/${encodeURIComponent(store.slug)}` : '/';
  const k = kind === 'not_found' ? 'notFound' : 'error';
  const support = code ?? (kind === 'not_found' ? '404' : null);
  return {
    title: w(`sweep.err.${k}.title`),
    what: w(`sweep.err.${k}.what`),
    safe: w(`sweep.err.${k}.safe`),
    now: kind === 'not_found' ? w(store ? 'sweep.err.notFound.nowStore' : 'sweep.err.notFound.nowPlatform', org) : w('sweep.err.error.now'),
    back: w(store ? 'sweep.err.backStore' : 'sweep.err.backPlatform', org),
    backHref: home,
    retry: w('sweep.err.retry'),
    orders: w('sweep.err.orders'),
    ordersHref: store ? `${home}/orders` : '/orders',
    code: support ? w('sweep.err.code', { code: support }) : null,
  };
}

/** The `kv_lang` cookie from a `document.cookie` string (a client boundary with no context). */
export function cookieLang(cookie: string | null | undefined): string {
  const raw = String(cookie ?? '').split(/;\s*/).find((c) => c.startsWith('kv_lang='))?.slice('kv_lang='.length);
  return resolveLanguage(raw ? decodeURIComponent(raw) : undefined).code;
}
