// apps/web-storefront/src/features/store4a/account.ts · PC-56 STORE-4a · C2 / C6 — the ACCOUNT page's pure half (W300). No React, no Next, no
// I/O; unit-tested in test/store4a-account.spec.ts.
//
// • THE CHROME (founder Q13 / HOTFIX-6 D4): a person's pages live under whichever chrome the person is in — the platform's /account… and an
//   organisation's /<slug>/account… — ONE screen component per page with a `chrome` prop; `accountHref` is the only place a path is built.
//   The DATA is the person's whatever the chrome (the API resolves the person from the token).
// • THE PROFILE (survey C-4): the name from `fullName` (never "—" for a name the platform holds); the phone and email as the SERVER masks them —
//   and masked AGAIN here if a value ever arrives bare (defence in depth: a full number never reaches the page); the language as a LABEL.
// • NO MONEY ARITHMETIC: every amount is the API's string, printed in the DATA's currency by `moneyText` at render; nothing here adds,
//   subtracts or multiplies a minor.
import { maskForDisplay } from '../chain/mask';

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE CHROME                                                                                                                          */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export type AccountChrome = { kind: 'platform' } | { kind: 'tenant'; slug: string };
export const PLATFORM_CHROME: AccountChrome = Object.freeze({ kind: 'platform' }) as AccountChrome;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function tenantChrome(slug: string): AccountChrome { return SLUG.test(slug) ? { kind: 'tenant', slug } : PLATFORM_CHROME; }
/** What a form carries so ONE action module answers both chromes: `platform`, or the organisation's slug (re-validated on the way in). */
export function chromeField(c: AccountChrome): string { return c.kind === 'tenant' ? c.slug : 'platform'; }
export function chromeOf(raw: unknown): AccountChrome {
  const s = typeof raw === 'string' ? raw : '';
  return s && s !== 'platform' && SLUG.test(s) ? { kind: 'tenant', slug: s } : PLATFORM_CHROME;
}
// PC-56 STORE-4c · C1: + 'preferences' (W302 — /account/preferences under both chromes; /notifications/preferences is a door to it).
export type AccountPage = '' | 'addresses' | 'addresses/new' | 'data' | 'delete' | 'preferences' | { edit: string } | { download: string };
/** The account's paths under a chrome, with a bounded query of plain words (never a value the buyer typed). */
export function accountHref(c: AccountChrome, page: AccountPage = '', q: Record<string, string | null | undefined> = {}): string {
  const base = c.kind === 'tenant' ? `/${encodeURIComponent(c.slug)}/account` : '/account';
  let sub = '';
  if (typeof page === 'string') sub = page ? `/${page}` : '';
  else if ('edit' in page) sub = UUID.test(page.edit) ? `/addresses/${page.edit}/edit` : '/addresses';
  else sub = UUID.test(page.download) ? `/data/${page.download}/download` : '/data';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string' && v !== '') p.set(k, v.slice(0, 120));
  const qs = p.toString();
  return `${base}${sub}${qs ? `?${qs}` : ''}`;
}
/** W3030's download: this app's own proxy route, the signed link BESIDE the session (never sliced — a token is longer than a plain word). */
export function downloadHref(c: AccountChrome, jobId: string, token: string): string {
  if (!UUID.test(jobId) || !/^[A-Za-z0-9._~-]{16,2048}$/.test(token)) return accountHref(c, 'data');
  return `${accountHref(c, { download: jobId })}?token=${encodeURIComponent(token)}`;
}
/** The shortcuts' doors under each chrome (W300 "My orders · offers · bids", "Notification preferences" — STORE-4c: the real page). */
export function shortcutHrefs(c: AccountChrome): { orders: string; offers: string; bids: string; preferences: string } {
  const pre = c.kind === 'tenant' ? `/${encodeURIComponent(c.slug)}` : '';
  // PC-56 STORE-4c · C1: the Preferences shortcut is the person's page under THIS chrome (it was the /notifications/preferences door)
  return { orders: `${pre}/orders`, offers: `${pre}/offers`, bids: `${pre}/auctions/bids`, preferences: accountHref(c, 'preferences') };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE PROFILE                                                                                                                         */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
const MASKED = /[*•]/;
/** A phone as the page may print it: the server's masked form, or — when a value arrives bare — masked here (five-of-ten policy). */
export function maskedPhone(raw: string | null | undefined): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return null;
  return MASKED.test(v) ? v : maskForDisplay(v);
}
/** An email as the page may print it: the server's masked form (`a***@x.in`), or masked here when it arrives bare. */
export function maskedEmail(raw: string | null | undefined): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return null;
  if (MASKED.test(v)) return v;
  return v.replace(/(^.).*(@.*$)/, '$1***$2');
}
export const ACCOUNT_LANGUAGES = ['en', 'hi', 'gu'] as const;
export type AccountLanguage = (typeof ACCOUNT_LANGUAGES)[number];
/** A language code as a LABEL key (`store4a.lang.<code>`); a code this site has no words for → null (the page prints the code). */
export function languageKey(code: string | null | undefined): string | null {
  const c = String(code ?? '').toLowerCase();
  return (ACCOUNT_LANGUAGES as readonly string[]).includes(c) ? `store4a.lang.${c}` : null;
}
export interface ProfileView { name: string | null; phone: string | null; email: string | null; languageCode: string | null; languageKey: string | null }
export function profileView(me: { fullName?: string | null; displayName?: string | null; phone?: string | null; email?: string | null; languageCode?: string | null; locale?: string | null } | null): ProfileView | null {
  if (!me) return null;
  const name = (typeof me.fullName === 'string' && me.fullName.trim()) || (typeof me.displayName === 'string' && me.displayName.trim()) || null;
  const lang = me.languageCode ?? me.locale ?? null;
  return { name, phone: maskedPhone(me.phone), email: maskedEmail(me.email), languageCode: lang, languageKey: languageKey(lang) };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* BUSINESS DETAILS (founder D5) · SAVED METHODS (D6) · THE WALLET LINE (D8)                                                          */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export type BusinessState = 'off' | 'error' | 'none' | 'pending' | 'verified' | 'rejected' | 'expired';
export interface BusinessView { state: BusinessState; legalName: string | null; gstinMasked: string | null; onInvoice: boolean }
/** `GET kyc/business` → the view. A 404 is the `kyc` switch OFF (the route answers NOT_FOUND only when its flag is off); any other failure
 *  is an error (never "none"). "On every invoice automatically" is said ONLY for a VERIFIED profile with a GSTIN — the invoice takes nothing
 *  else (founder D5). */
export function businessView(r: { ok: true; value: { status?: string | null; legalName?: string | null; gstinMasked?: string | null } } | { ok: false; status: number | null }): BusinessView {
  if (!r.ok) return { state: r.status === 404 ? 'off' : 'error', legalName: null, gstinMasked: null, onInvoice: false };
  const s = String(r.value.status ?? 'none');
  const state: BusinessState = (['none', 'pending', 'verified', 'rejected', 'expired'] as const).includes(s as 'none') ? (s as BusinessState) : 'none';
  const gstin = r.value.gstinMasked ?? null;
  return { state, legalName: r.value.legalName ?? null, gstinMasked: gstin, onInvoice: state === 'verified' && !!gstin };
}
export interface MethodRow { id: string; kind: 'upi_autopay' | 'bank' | 'upi'; masked: string; detail: string | null; status: string | null }
/** `GET wallet/instruments` → rows, masked as the server answers them (a bare value is never printed: no last-4 → the row says nothing). */
export function methodRows(s: { mandates?: Array<{ id: string; handleMasked?: string | null; status?: string | null }>; accounts?: Array<{ id: string; kind: 'bank' | 'upi'; last4?: string | null; ifsc?: string | null; upiMasked?: string | null }> } | null): MethodRow[] {
  if (!s) return [];
  const out: MethodRow[] = [];
  for (const m of s.mandates ?? []) if (m.handleMasked && MASKED.test(m.handleMasked)) out.push({ id: m.id, kind: 'upi_autopay', masked: m.handleMasked, detail: null, status: m.status ?? null });
  for (const a of s.accounts ?? []) {
    if (a.kind === 'upi' && a.upiMasked && MASKED.test(a.upiMasked)) out.push({ id: a.id, kind: 'upi', masked: a.upiMasked, detail: null, status: null });
    if (a.kind === 'bank' && a.last4 && /^\d{4}$/.test(a.last4)) out.push({ id: a.id, kind: 'bank', masked: `••${a.last4}`, detail: a.ifsc ?? null, status: null });
  }
  return out;
}
/** Which currency the wallet line reads (founder D8 — refuse to guess): the currency the person's OWN money is in (`privacy.commitments`
 *  answers it from their wallet rows), else the session store's currency, NAMED as such; neither → no wallet line. */
export function walletCurrency(fromData: string | null | undefined, fromStore: string | null | undefined): { currency: string; source: 'data' | 'store' } | null {
  const ok = (c: unknown) => typeof c === 'string' && /^[A-Z]{3}$/.test(c);
  if (ok(fromData)) return { currency: String(fromData), source: 'data' };
  if (ok(fromStore)) return { currency: String(fromStore), source: 'store' };
  return null;
}
/** The address count as the shortcut prints it: the API's list is capped at 50 — at the cap the count is "50+" (never a tenant-wide count). */
export const ADDRESS_LIST_CAP = 50;
export function addressCount(n: number): { n: number; capped: boolean } { return { n: Math.min(n, ADDRESS_LIST_CAP), capped: n >= ADDRESS_LIST_CAP }; }

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE PROFILE EDIT's outcome · THE REQUEST HISTORY                                                                                   */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const ACCOUNT_OK = ['profile'] as const;
export const ACCOUNT_ERRORS = ['email', 'empty', 'profile'] as const;
export function readOne<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
export const DSR_STATUSES = ['open', 'in_progress', 'completed', 'rejected'] as const;
export function dsrStatusKey(s: string): string { return (DSR_STATUSES as readonly string[]).includes(s) ? `store4a.dsr.status.${s}` : 'store4a.dsr.status.unknown'; }
export function dsrKindKey(k: string): string { return k === 'deletion' ? 'store4a.dsr.kind.deletion' : 'store4a.dsr.kind.export'; }
