// apps/web-storefront/src/features/store6b/drafts.ts · PC-56 STORE-6b · D1 / D2 / D4 (founder Q3 = b, Q4, Q7) — YOUR UNSENT WORDS STAY ON YOUR
// PHONE AND LEAVE ONLY WHEN YOU SAY. PURE (no DOM, no IndexedDB, no Next): the rules of a device draft, unit-tested (test/store6b-drafts.spec.ts).
//
//   • WHAT is kept: a message body (the thread composer, `messages/[id]`) and a review (the review form and the review edit form: the overall
//     stars, the dimension stars, the words) — typed by THIS person on THIS phone, kept as they type. NOTHING else: never a cart line, an
//     address, a preference, an offer, a bid, the sign-in form; never a hidden field (`slug`, `id`, `key`, `conversationId` — the `ref` is the
//     only id kept); never a token or a key (`safeField` refuses anything shaped like one). Which forms may draft is DERIVED from the act
//     registry (features/store6/acts.ts — `isDraftable`): only three `content` acts; every money and countdown act is never draftable (E7).
//   • KEYED BY (host, store slug, owner marker `kvs_owner`, kind, ref): the owner marker is HOTFIX-8's random, non-secret, JS-readable value
//     minted at a sign-in whose person is new to this device. No marker → drafts are OFF (nothing kept, nothing shown — fail closed). A draft
//     whose owner is not the current marker is removed at the next load WITHOUT being shown (survey E1 — the OWNER MISMATCH rule).
//   • NOTHING LEAVES BY ITSELF (founder D1 / Q4): there is no send here and no queue. "Send now" is a LINK to the live page (`liveHref`), whose
//     keeper fills the form from the phone; the person presses Send there, under the key that page minted at ITS render.
//   • HOW LONG (founder D2 / Q7): `draftState` — fresh under 7 days; from 7 days "still want to send this?" (asked once; Keep or Discard);
//     from 30 days removed at the next sweep, with a one-line notice on "On this phone". Sign-out and another person's sign-in wipe everything
//     (HOTFIX-8's `Clear-Site-Data: "storage"`, + the JS-readable wipe marker for a browser that ignores the header — features/offline/owner.ts).
// (Client-safe: this module is bundled into the browser islands — it imports nothing that needs Node. `REVIEW_WORDS_MAX` mirrors
// features/store5a/review.ts `REVIEW_BODY_MAX` (that module needs node:zlib); a spec pins them equal.)
import { STOREFRONT_ACTS } from '../store6/acts';
import type { AccountChrome } from '../store4a/account';

export type DraftKind = 'message' | 'review';
export interface MessageDraftFields { body: string }
export interface ReviewDraftFields { stars: number | null; subRatings: Record<string, number>; body: string }
export type DraftFields = MessageDraftFields | ReviewDraftFields;

export interface Draft {
  /** opaque, random (`d_` + 22 url-safe characters) — the only id that ever appears in a URL (`?draft=`, `?discard=`); never the owner */
  id: string;
  kind: DraftKind;
  host: string;
  slug: string;
  /** the owner marker (`kvs_owner`) the draft was typed under */
  owner: string;
  /** the conversation id (a message) or the order id (a review) — public ids the live page already carries in its path */
  ref: string;
  fields: DraftFields;
  /** a review typed on the EDIT form (its live page is `/review/edit`) */
  edit?: boolean;
  /** ms since the epoch: the last time the person typed into it */
  savedAt: number;
  /** ms: when "still want to send this?" was answered Keep (asked once) */
  askedAt?: number;
}

/** The three parts of a draft's scope; `list` / `clear` take any subset (a missing part matches every value). */
export interface DraftScope { host: string; slug?: string; owner?: string }

export const DAY_MS = 24 * 60 * 60 * 1000;
/** From this age a draft asks "still want to send this?" (founder Q7) — the copy interpolates it. */
export const ASK_DAYS = 7;
/** From this age a draft is removed at the next sweep, with a notice (founder Q7) — the copy interpolates it. */
export const EXPIRE_DAYS = 30;
/** The live pages' own limits (the composer's `maxLength`, the review words' `REVIEW_BODY_MAX`). */
export const MESSAGE_BODY_MAX = 4000;
export const REVIEW_WORDS_MAX = 4000;
/** JS-readable one-shot set by HOTFIX-8's armed clear pass (features/offline/owner.ts): "wipe every draft on this phone at the next load". */
export const DRAFTS_WIPE_COOKIE = 'kvs_wipe';
/** The hidden fields the live forms carry — NEVER kept as values (the keeper reads named visible fields only; a spec pins this list). */
export const HIDDEN_FIELDS: readonly string[] = Object.freeze(['slug', 'id', 'key', 'conversationId']);

const ID_RE = /^d_[A-Za-z0-9_-]{22}$/;
const OWNER_RE = /^[A-Za-z0-9_-]{22}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isDraftId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
export const isOwner = (v: unknown): v is string => typeof v === 'string' && OWNER_RE.test(v);

/** A fresh opaque id from 16 random bytes (the caller supplies them: `crypto.getRandomValues` in the browser, a fixed array in specs). */
export function newDraftId(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < 22; i++) s += abc[(bytes[i % bytes.length] + i * 7) & 63];
  return `d_${s}`;
}

/** The scope string the IndexedDB index holds — or null when there is no owner marker (drafts OFF: fail closed). */
export function draftScope(host: string, slug: string, owner: string | null | undefined): string | null {
  if (!isOwner(owner) || !SLUG_RE.test(slug) || !host) return null;
  return `${host}|${slug}|${owner}`;
}

/** Does a draft fall inside a (partial) scope? */
export function inScope(d: Pick<Draft, 'host' | 'slug' | 'owner'>, s: DraftScope): boolean {
  return d.host === s.host && (s.slug === undefined || d.slug === s.slug) && (s.owner === undefined || d.owner === s.owner);
}

// ─────────────────────────────── which forms may draft (E7: derived from the act registry) ───────────────────────────────

/** The ONLY acts whose form may keep a draft: the composer, the review form, the review edit form (all `content` in acts.ts). */
export const DRAFT_ACTS: readonly { file: string; name: string; kind: DraftKind; edit: boolean }[] = Object.freeze([
  { file: '[tenantSlug]/messages/[id]/actions.ts', name: 'postMessageAction', kind: 'message', edit: false },
  { file: '[tenantSlug]/orders/[id]/review/actions.ts', name: 'previewReviewAction', kind: 'review', edit: false },
  { file: '[tenantSlug]/orders/[id]/review/actions.ts', name: 'editReviewAction', kind: 'review', edit: true },
]);

/** May the form posting to this act keep a draft on the phone? Only a `content` act of the registry AND one of the three — never money,
 *  never a countdown, never a device act, never an unknown export. */
export function isDraftable(file: string, name: string): boolean {
  const e = STOREFRONT_ACTS.find((a) => a.file === file && a.name === name);
  return !!e && e.cls === 'content' && DRAFT_ACTS.some((d) => d.file === file && d.name === name);
}

// ─────────────────────────────── how long ───────────────────────────────

export type DraftState = 'fresh' | 'ask' | 'expired';

/** fresh < 7 days ≤ ask < 30 days ≤ expired (a clock that runs backwards reads fresh). */
export function draftState(savedAt: number, now: number): DraftState {
  const age = now - savedAt;
  if (age >= EXPIRE_DAYS * DAY_MS) return 'expired';
  if (age >= ASK_DAYS * DAY_MS) return 'ask';
  return 'fresh';
}

/** Is this draft owed the 7-day question (in `ask`, not yet answered Keep)? */
export function needsAsk(d: Pick<Draft, 'savedAt' | 'askedAt'>, now: number): boolean {
  return draftState(d.savedAt, now) === 'ask' && d.askedAt === undefined;
}

/**
 * THE SWEEP, at every load: which drafts go (another owner's — never shown; expired ones — with a notice) and which are asked about.
 * `owner` null (no marker on this device) → every draft goes (nothing may be shown to an unknown person).
 */
export function sweep(drafts: readonly Draft[], owner: string | null | undefined, now: number): { remove: string[]; expired: string[]; ask: string[] } {
  const remove: string[] = []; const expired: string[] = []; const ask: string[] = [];
  for (const d of drafts) {
    if (!isOwner(owner) || d.owner !== owner) { remove.push(d.id); continue; }
    if (draftState(d.savedAt, now) === 'expired') { remove.push(d.id); expired.push(d.id); continue; }
    if (needsAsk(d, now)) ask.push(d.id);
  }
  return { remove, expired, ask };
}

/** What a sweep leaves to show (the owner's own, unexpired) — the list is never shown without this filter. */
export function shown(drafts: readonly Draft[], owner: string | null | undefined, now: number): Draft[] {
  const { remove } = sweep(drafts, owner, now);
  return drafts.filter((d) => !remove.includes(d.id));
}

// ─────────────────────────────── what may be kept ───────────────────────────────

/** Token- and key-shaped values: a JWT (`eyJ…`), a platform key (`kv_…`), an act key (`send:` / `review:` / `review-edit:`), 32+ hex. */
const TOKENISH = [/^\s*eyJ/, /^\s*kv_/i, /^\s*send:/i, /^\s*review(-edit)?:/i, /[0-9a-f]{32,}/i];

/** A text value that may be kept (≤ max characters, not token-shaped), or null — REFUSED, never stored. */
export function safeField(value: unknown, max: number = MESSAGE_BODY_MAX): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > max) return null;
  if (TOKENISH.some((re) => re.test(value))) return null;
  return value;
}

/** A star value 1–5, or null ("not rated"). */
export function safeStars(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[1-5]$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** The fields of one kind, made safe — or null when anything is refused (then nothing is written; the draft already kept stays as it was). */
export function safeFields(kind: DraftKind, f: { body?: unknown; stars?: unknown; subRatings?: Record<string, unknown> }): DraftFields | null {
  if (kind === 'message') {
    const body = safeField(f.body ?? '', MESSAGE_BODY_MAX);
    return body === null ? null : { body };
  }
  const body = safeField(f.body ?? '', REVIEW_WORDS_MAX);
  if (body === null) return null;
  const subRatings: Record<string, number> = {};
  for (const [code, v] of Object.entries(f.subRatings ?? {})) {
    if (!/^[a-z0-9_]{1,40}$/.test(code)) return null;
    const s = safeStars(v);
    if (s !== null) subRatings[code] = s;
  }
  return { stars: safeStars(f.stars), subRatings, body };
}

/** Is there anything worth keeping (a draft of nothing is removed, not kept)? */
export function isEmptyFields(f: DraftFields): boolean {
  if ('stars' in f) return f.body.trim() === '' && f.stars === null && Object.keys(f.subRatings).length === 0;
  return f.body.trim() === '';
}

// ─────────────────────────────── where it leaves from ───────────────────────────────

/**
 * "Send now": the draft's LIVE page with `?draft=<id>` — the thread or the review (or its edit) form — never a send. Under an organisation's
 * chrome only that organisation's drafts get a link (null for another's: white-label, and the page lists none anyway).
 */
export function liveHref(d: Pick<Draft, 'id' | 'kind' | 'slug' | 'ref' | 'edit'>, chrome: AccountChrome): string | null {
  if (!SLUG_RE.test(d.slug) || !REF_RE.test(d.ref) || !isDraftId(d.id)) return null;
  if (chrome.kind === 'tenant' && chrome.slug !== d.slug) return null;
  const s = encodeURIComponent(d.slug); const r = encodeURIComponent(d.ref);
  const path = d.kind === 'message' ? `/${s}/messages/${r}` : `/${s}/orders/${r}/review${d.edit ? '/edit' : ''}`;
  return `${path}?draft=${encodeURIComponent(d.id)}`;
}

/** The first words of a draft for the list (whole words, at most `max` characters, an ellipsis when cut). */
export function firstWords(text: string, max = 80): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** Age in whole units for the "· <age>" words: now / minutes / hours / days. */
export function ageParts(savedAt: number, now: number): { unit: 'now' | 'minutes' | 'hours' | 'days'; n: number } {
  const m = Math.floor(Math.max(0, now - savedAt) / 60000);
  if (m < 1) return { unit: 'now', n: 0 };
  if (m < 60) return { unit: 'minutes', n: m };
  const h = Math.floor(m / 60);
  if (h < 24) return { unit: 'hours', n: h };
  return { unit: 'days', n: Math.floor(h / 24) };
}

/** On a success render: which drafts of this (kind, ref) go — those saved at or before the success page rendered (words typed after it stay). */
export function doneRemovals(drafts: readonly Draft[], kind: DraftKind, ref: string, renderedAt: number): string[] {
  return drafts.filter((d) => d.kind === kind && d.ref === ref && d.savedAt <= renderedAt).map((d) => d.id);
}

// ─────────────────────────────── where they live ───────────────────────────────

/** A failure is a named outcome, never a throw into the page. */
export type StoreResult<T> = { ok: true; value: T } | { ok: false; reason: 'unavailable' | 'blocked' | 'write' };

/** The phone's draft store (lib/draft-store-idb.ts in the browser; `MemoryDraftStore` in specs). */
export interface DraftStore {
  list(scope: DraftScope): Promise<StoreResult<Draft[]>>;
  put(draft: Draft): Promise<StoreResult<true>>;
  remove(id: string): Promise<StoreResult<true>>;
  clear(scope: DraftScope): Promise<StoreResult<number>>;
}

/** An in-memory store (specs; and the shape the IndexedDB adapter must match). `failWrites` makes every write a named failure. */
export class MemoryDraftStore implements DraftStore {
  readonly rows = new Map<string, Draft>();
  failWrites = false;
  async list(scope: DraftScope): Promise<StoreResult<Draft[]>> { return { ok: true, value: [...this.rows.values()].filter((d) => inScope(d, scope)).map((d) => ({ ...d })) }; }
  async put(d: Draft): Promise<StoreResult<true>> { if (this.failWrites) return { ok: false, reason: 'write' }; this.rows.set(d.id, { ...d }); return { ok: true, value: true }; }
  async remove(id: string): Promise<StoreResult<true>> { if (this.failWrites) return { ok: false, reason: 'write' }; this.rows.delete(id); return { ok: true, value: true }; }
  async clear(scope: DraftScope): Promise<StoreResult<number>> {
    if (this.failWrites) return { ok: false, reason: 'write' };
    let n = 0; for (const [id, d] of [...this.rows]) if (inScope(d, scope)) { this.rows.delete(id); n++; }
    return { ok: true, value: n };
  }
}

/** Run the sweep against a store: remove another owner's and expired drafts; report what was expired and what is owed the question. */
export async function runSweep(store: DraftStore, host: string, owner: string | null | undefined, now: number): Promise<{ ok: boolean; expired: number; ask: string[]; kept: Draft[] }> {
  const all = await store.list({ host });
  if (!all.ok) return { ok: false, expired: 0, ask: [], kept: [] };
  const s = sweep(all.value, owner, now);
  let ok = true;
  for (const id of s.remove) { const r = await store.remove(id); if (!r.ok) ok = false; }
  return { ok, expired: s.expired.length, ask: s.ask, kept: all.value.filter((d) => !s.remove.includes(d.id)) };
}

/** The catalogue words for an age (`{n}` interpolated by the caller's numbers — no figure is baked into a value). */
export interface AgeLabels { now: string; minutes: string; hours: string; days: string }
export function ageText(savedAt: number, now: number, l: AgeLabels, fmt: (n: number) => string = String): string {
  const a = ageParts(savedAt, now);
  return a.unit === 'now' ? l.now : l[a.unit].replace('{n}', fmt(a.n));
}
