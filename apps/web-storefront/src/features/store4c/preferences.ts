// apps/web-storefront/src/features/store4c/preferences.ts · PC-56 STORE-4c · C3 / C4 / C5 — the PREFERENCES page's pure half (canon W302 and
// the REAL save chain W3134 confirm → W3135 success / W3136 failure). No React, no Next, no I/O; unit-tested in test/store4c-notifications.spec.ts.
//
// • THE MATRIX IS THE SERVER'S (`notifications.matrix({ audience: 'buyer' })`, STORE-4c B4): only the events a buyer can receive, by tier; per
//   event the channels it is SENT on as switches; a LOCKED event (`payment.success` after founder D1) is drawn disabled and "always on" — the
//   page never lets a buyer untick it, and the server refuses it anyway (`NOTIFICATION_CANNOT_OPT_OUT`).
// • PROMOTIONAL NOTICES ARE OPT-IN AND CONSENT-BOUND (founder D2): every promotional event is ONE switch, OFF unless the person opted in; turning
//   it on records the `marketing` consent AND the opt-in rows; off withdraws both. The page prints both halves.
// • QUIET HOURS (survey C-7): the window in force (the person's own, else the organisation's default) and the zone it is read in — from the
//   matrix; the zone choice is "the organisation's zone" (blank, resolved by the server) or the person's own saved zone. NEVER a literal zone.
// • ONE LANGUAGE (founder D3): one select, the platform's ACTIVE registry that this site can also speak; saving sets the account language
//   (notices) AND this site's language.
// • THE CHAIN (W3134–W3136): the server's three reviews are the confirm; a key minted at render (`prefs:<uuid>`) rides the whole chain and each
//   act derives its own (`:c` consent, `:p` preferences, `:q` quiet hours) — a Retry replays the same keys (nothing applied twice).

export interface MatrixCellLike { channel: string; sentOn: boolean; enabled: boolean | null }
export interface MatrixEventLike { code: string; defaultName: string; priority: string; locked: boolean; cells: MatrixCellLike[]; consent?: { purpose: string; granted: boolean } }
export interface MatrixLike {
  tiers: Array<{ tier: string; events: MatrixEventLike[] }>;
  routineRule?: { decided: boolean; on: boolean } | null;
  quietHours: {
    effective: { starts: string; ends: string; timezone: string; source: 'own' | 'tenant_default' } | null;
    own: { starts: string; ends: string; timezone: string } | null; tenantDefault: { starts: string; ends: string } | null; tenantZone: string | null;
    held: string[]; neverHeld: string[];
  };
  language: { current: string | null; active: Array<{ code: string; nameEnglish: string; nameNative: string }> };
}

export const cellName = (eventCode: string, channel: string) => `${eventCode}::${channel}`;
export interface CellView { name: string; channel: string; enabled: boolean; locked: boolean }
export interface EventView { code: string; defaultName: string; priority: string; locked: boolean; cells: CellView[] }
export interface PromotionalView { events: string[]; cells: CellView[]; on: boolean; consentGranted: boolean; purpose: string }
export interface MatrixView { tiers: Array<{ tier: string; events: EventView[] }>; promotional: PromotionalView | null; lockedCount: number }

/** The buyer matrix as the page draws it: tiers of NON-promotional events (each with the channels it is sent on), and the promotional group
 *  as ONE switch (on = every promotional cell enabled AND the consent granted — both halves). */
export function matrixView(m: MatrixLike): MatrixView {
  const tiers: MatrixView['tiers'] = [];
  const promoEvents: string[] = []; const promoCells: CellView[] = []; let granted = true; let purpose = 'marketing'; let anyPromo = false;
  let lockedCount = 0;
  for (const t of m.tiers) {
    const evs: EventView[] = [];
    for (const e of t.events) {
      const cells = e.cells.filter((c) => c.sentOn).map((c) => ({ name: cellName(e.code, c.channel), channel: c.channel, enabled: e.locked ? true : c.enabled === true, locked: e.locked }));
      if (cells.length === 0) continue;
      if (e.priority === 'promotional') {
        anyPromo = true; promoEvents.push(e.code); promoCells.push(...cells);
        if (!e.consent?.granted) granted = false;
        if (e.consent?.purpose) purpose = e.consent.purpose;
        continue;
      }
      if (e.locked) lockedCount += 1;
      evs.push({ code: e.code, defaultName: e.defaultName, priority: e.priority, locked: e.locked, cells });
    }
    if (evs.length > 0) tiers.push({ tier: t.tier, events: evs });
  }
  const promotional = anyPromo ? { events: promoEvents, cells: promoCells, on: granted && promoCells.every((c) => c.enabled), consentGranted: granted, purpose } : null;
  return { tiers, promotional, lockedCount };
}

export interface PrefChange { eventCode: string; channel: string; isEnabled: boolean }
/** What the form changes against what is in force: each unlocked cell whose ticked state differs; the promotional switch sets EVERY promotional
 *  cell; a LOCKED cell is never a change (the page draws it disabled — a forged untick is dropped here and refused by the server). */
export function formChanges(v: MatrixView, ticked: ReadonlySet<string>, promoOn: boolean): { changes: PrefChange[]; consent: boolean | null } {
  const changes: PrefChange[] = [];
  for (const t of v.tiers) for (const e of t.events) for (const c of e.cells) {
    if (c.locked) continue;
    const want = ticked.has(c.name);
    if (want !== c.enabled) changes.push({ eventCode: e.code, channel: c.channel, isEnabled: want });
  }
  let consent: boolean | null = null;
  if (v.promotional) {
    for (const c of v.promotional.cells) if (c.enabled !== promoOn) { const [eventCode, channel] = c.name.split('::'); changes.push({ eventCode, channel, isEnabled: promoOn }); }
    if (promoOn !== v.promotional.consentGranted) consent = promoOn;
  }
  return { changes, consent };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* QUIET HOURS (C-7 · never a zone literal)                                                                                            */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export interface WindowView { starts: string; ends: string; zone: string | null; source: 'own' | 'tenant_default' | 'none'; tenantZone: string | null; held: string[]; neverHeld: string[] }
const hhmm = (s: string | null | undefined) => (typeof s === 'string' && /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : '');
export function windowView(m: MatrixLike): WindowView {
  const q = m.quietHours; const e = q.effective;
  return { starts: hhmm(e?.starts), ends: hhmm(e?.ends), zone: e?.timezone ?? q.tenantZone ?? null, source: e ? e.source : 'none', tenantZone: q.tenantZone ?? null, held: [...(q.held ?? [])], neverHeld: [...(q.neverHeld ?? [])] };
}
/** The zone choices: the organisation's (posted BLANK — the server resolves it) and, when the person saved a different one, theirs. */
export function zoneOptions(m: MatrixLike): Array<{ value: string; zone: string | null; kind: 'organisation' | 'own' }> {
  const out: Array<{ value: string; zone: string | null; kind: 'organisation' | 'own' }> = [{ value: '', zone: m.quietHours.tenantZone ?? null, kind: 'organisation' }];
  const own = m.quietHours.own?.timezone ?? null;
  if (own && own !== m.quietHours.tenantZone) out.push({ value: own, zone: own, kind: 'own' });
  return out;
}
/** The window the form posts, or null when nothing changed (the starts/ends in force and the same zone choice). */
export function windowChange(m: MatrixLike, posted: { starts: string; ends: string; zone: string }): { starts: string; ends: string; timezone?: string } | null {
  const w = windowView(m);
  const ownZone = m.quietHours.own?.timezone ?? null;
  const currentChoice = w.source === 'own' && ownZone && ownZone !== m.quietHours.tenantZone ? ownZone : '';
  const allowed = new Set(zoneOptions(m).map((o) => o.value));
  const zone = allowed.has(posted.zone) ? posted.zone : '';
  if (posted.starts === w.starts && posted.ends === w.ends && zone === currentChoice) return null;
  return zone ? { starts: posted.starts, ends: posted.ends, timezone: zone } : { starts: posted.starts, ends: posted.ends };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* ONE LANGUAGE (founder D3)                                                                                                           */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
/** The languages the ONE select offers: the platform's ACTIVE registry that this site can also speak (a language the site cannot render would
 *  split the one answer in two again). The rest of the registry is the switcher's honest "coming soon" list — never "+9 more at launch". */
export function languageOptions(m: MatrixLike, siteSupported: (code: string) => boolean): Array<{ code: string; nameNative: string }> {
  return m.language.active.filter((l) => siteSupported(l.code)).map((l) => ({ code: l.code, nameNative: l.nameNative }));
}
/** The language route's decision (C4): the cookie is ALWAYS set; the account language is PATCHed (best effort) only for a signed-in person. */
export function langRouteDecision(i: { lang: string; signedIn: boolean }): { cookie: string; patchAccount: boolean } {
  return { cookie: i.lang, patchAccount: i.signedIn };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE CHAIN (W3134 → W3135 / W3136) · the server-held draft                                                                           */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const PREFS_DRAFT_COOKIE = 'kvs_prefs_draft';
export interface PrefsDraft {
  v: 1; key: string;
  changes: PrefChange[]; consent: boolean | null;
  quiet: { starts: string; ends: string; timezone?: string } | null;
  language: string | null;
}
const CODE = /^[a-z][a-z0-9_.]{1,79}$/;
const CHANNEL = /^(inapp|push|sms|whatsapp|email|ivr)$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const PREFS_KEY_RE = /^prefs:[0-9a-f-]{36}$/;
export function readPrefsKey(raw: unknown): string | null { const v = Array.isArray(raw) ? raw[0] : raw; return typeof v === 'string' && PREFS_KEY_RE.test(v) ? v : null; }
/** The act's own key, derived from the chain's (consent · preferences · quiet hours) — a Retry derives the same three. */
export function actKey(key: string, act: 'c' | 'p' | 'q'): string { return `${key}:${act}`; }
export function encodePrefsDraft(d: PrefsDraft): string { return Buffer.from(JSON.stringify(d), 'utf8').toString('base64url'); }
export function decodePrefsDraft(raw: string | null | undefined, key: string | null): PrefsDraft | null {
  if (!raw || !key) return null;
  try {
    const d = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as PrefsDraft;
    if (!d || d.v !== 1 || d.key !== key || !Array.isArray(d.changes) || d.changes.length > 200) return null;
    const changes = d.changes.filter((c) => c && CODE.test(String(c.eventCode)) && CHANNEL.test(String(c.channel)) && typeof c.isEnabled === 'boolean')
      .map((c) => ({ eventCode: String(c.eventCode), channel: String(c.channel), isEnabled: c.isEnabled === true }));
    const quiet = d.quiet && HHMM.test(String(d.quiet.starts)) && HHMM.test(String(d.quiet.ends))
      ? { starts: String(d.quiet.starts), ends: String(d.quiet.ends), ...(typeof d.quiet.timezone === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(d.quiet.timezone) ? { timezone: d.quiet.timezone } : {}) }
      : null;
    const language = typeof d.language === 'string' && /^[a-z]{2,3}$/.test(d.language) ? d.language : null;
    const consent = d.consent === true ? true : d.consent === false ? false : null;
    return { v: 1, key, changes, consent, quiet, language };
  } catch { return null; }
}
export function draftIsEmpty(d: Pick<PrefsDraft, 'changes' | 'consent' | 'quiet' | 'language'>): boolean {
  return d.changes.length === 0 && d.consent === null && d.quiet === null && d.language === null;
}

/** W3136 — the failure, NAMED. */
export const PREFS_FAILURES = ['cannot_opt_out', 'zone', 'window', 'language', 'validation', 'concurrency', 'consent', 'server'] as const;
export type PrefsFailure = (typeof PREFS_FAILURES)[number];
export function prefsFailureOf(code: string | null | undefined, status: number | null | undefined, act: 'consent' | 'preferences' | 'quiet' | 'language'): PrefsFailure {
  if (code === 'NOTIFICATION_CANNOT_OPT_OUT') return 'cannot_opt_out';
  if (code === 'INBOX_FORM_REFUSED') return act === 'quiet' ? 'zone' : 'validation';
  if (act === 'language' && (status === 422 || status === 400)) return 'language';
  if (code === 'VALIDATION_FAILED' || status === 422 || status === 400) return act === 'quiet' ? 'window' : 'validation';
  if (status === 409) return 'concurrency';
  if (act === 'consent') return 'consent';
  return 'server';
}
export const PREFS_OK = ['saved'] as const;
export const PREFS_ERRORS = ['nothing', 'load', 'window'] as const;
export function readOne<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
/** The review's refusal codes the page names (the server's words: shared/form-review + communication/domain/inbox-review). */
export function refusalKey(code: string): string {
  const known = ['CANNOT_OPT_OUT', 'EVENT_UNKNOWN', 'CHANNEL_NOT_SENT', 'NOTHING_CHANGED', 'STARTS_INVALID', 'ENDS_INVALID', 'TIMEZONE_UNKNOWN', 'TIMEZONE_UNUSABLE',
    'WINDOW_UNCHANGED', 'LANGUAGE_REQUIRED', 'LANGUAGE_UNKNOWN', 'LANGUAGE_UNCHANGED', 'TOO_LONG', 'VALUE_REJECTED'];
  return known.includes(code) ? `store4c.review.refusal.${code}` : 'store4c.review.refusal.other';
}
/** A review refusal that does NOT block the save (an unchanged part simply is not written). */
export function isBlocking(code: string): boolean { return !['NOTHING_CHANGED', 'WINDOW_UNCHANGED', 'LANGUAGE_UNCHANGED'].includes(code); }
