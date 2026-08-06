// apps/web-admin/src/features/support/desk.ts · PURE rules for the support-desk depth screens (PC-56 ADMIN-2:
// macros W053, the SLA matrix W054, agent performance W055, CSAT W056). No IO, no React → unit-provable.

// ---------------------------------------------------------------------------
// Macros (W053)
// ---------------------------------------------------------------------------
/** Mirror of admin-api's live-language list (DEV-21: hi/en/gu are live; the other eleven are machine-draft-pending
 *  review). Kept here so the form can only OFFER a language the server will accept. */
export const MACRO_LANGUAGES = ['en', 'hi', 'gu'] as const;
export type MacroLanguage = (typeof MACRO_LANGUAGES)[number];
export const REQUIRED_LANGUAGE: MacroLanguage = 'en';

export type MacroError = 'slug' | 'title' | 'english' | 'body' | 'language' | 'duplicate';
export type MacroResult =
  | { ok: true; value: { slug: string; title: string; bodies: Array<{ languageCode: MacroLanguage; body: string }>; notes?: string } }
  | { ok: false; error: MacroError; at?: MacroLanguage };

export const MIN_BODY = 20;

/**
 * Build a macro from the form's per-language textareas.
 *
 * A BLANK LANGUAGE IS OMITTED, NOT REJECTED. An author writing English today and Hindi tomorrow is the normal case —
 * forcing all three at once would produce placeholder Hindi, which is worse than no Hindi because it looks reviewed.
 * The English body IS required, because it is what the desk checks the others against.
 *
 * The error carries WHICH language failed (`at`), so a three-textarea form can point at the right box instead of
 * saying "invalid" above all of them.
 */
export function buildMacro(raw: {
  slug: string; title: string; notes?: string; bodies: Partial<Record<MacroLanguage, string>>;
}): MacroResult {
  const slug = raw.slug.trim().replace(/^\/+/, '').toLowerCase();
  if (slug.length < 3 || slug.length > 60 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { ok: false, error: 'slug' };

  const title = raw.title.trim();
  if (title.length < 3 || title.length > 150) return { ok: false, error: 'title' };

  const bodies: Array<{ languageCode: MacroLanguage; body: string }> = [];
  for (const lang of MACRO_LANGUAGES) {
    const text = (raw.bodies[lang] ?? '').trim();
    if (!text) continue;                                    // omitted, not rejected — see the docblock
    if (text.length < MIN_BODY) return { ok: false, error: 'body', at: lang };
    if (text.length > 4000) return { ok: false, error: 'body', at: lang };
    bodies.push({ languageCode: lang, body: text });
  }
  if (!bodies.some((b) => b.languageCode === REQUIRED_LANGUAGE)) return { ok: false, error: 'english' };

  const notes = (raw.notes ?? '').trim();
  return { ok: true, value: { slug, title, bodies, ...(notes ? { notes } : {}) } };
}

export interface MacroRow {
  id?: string; slug?: string; title?: string; isActive?: boolean;
  languages?: string[]; missingLanguages?: string[]; uses30d?: number; csatAfterUseBps?: number | null;
}

/** Which live languages this macro lacks. Computed locally as well as server-side so the list can flag coverage even
 *  if an older API build did not send the field. */
export function missingLanguages(present: readonly string[] | undefined): MacroLanguage[] {
  const have = new Set((present ?? []).map((p) => p.toLowerCase()));
  return MACRO_LANGUAGES.filter((l) => !have.has(l));
}

/** A macro used often but MISSING a language is the one to fix first: it is being pasted in the wrong language many
 *  times a day. Sorting by that rather than alphabetically is what makes the list actionable. */
export function sortMacrosByCoverageRisk(rows: readonly MacroRow[]): MacroRow[] {
  return [...rows].sort((a, b) => {
    const am = missingLanguages(a.languages).length;
    const bm = missingLanguages(b.languages).length;
    const aRisk = am > 0 ? (a.uses30d ?? 0) : -1;
    const bRisk = bm > 0 ? (b.uses30d ?? 0) : -1;
    if (aRisk !== bRisk) return bRisk - aRisk;
    return String(a.slug ?? '') < String(b.slug ?? '') ? -1 : 1;
  });
}

/** True when a macro is used but has never been rated — worth saying, because "no CSAT" reads as bad on a dashboard
 *  and it is not. */
export function usedButUnrated(m: MacroRow): boolean {
  return (m.uses30d ?? 0) > 0 && (m.csatAfterUseBps === null || m.csatAfterUseBps === undefined);
}

// ---------------------------------------------------------------------------
// Agent performance (W055)
// ---------------------------------------------------------------------------
export interface AgentRow {
  agentUserId?: string; handled?: number; firstResponseP50Sec?: number | null;
  csatAvgBps?: number | null; csatCount?: number; reopenedCount?: number;
}

/** Human duration for a p50. Null in, null out — an agent with nothing answered yet has no median, and rendering "0s"
 *  would make them look instant. */
export function humanSeconds(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return null;
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Minimum ratings before a CSAT figure is worth showing as a JUDGEMENT. Below it the number is displayed with its
 *  count and no comparison — one five-star rating does not make somebody the best agent on the desk, and a dashboard
 *  that ranks on it will have people chasing ratings instead of answers. */
export const CSAT_MIN_SAMPLE = 10;
export function csatIsIndicative(m: AgentRow): boolean { return (m.csatCount ?? 0) >= CSAT_MIN_SAMPLE; }

/** Reopen rate in basis points, or NULL when nothing was handled — 0% for an agent who handled nothing would read as
 *  a perfect record. */
export function reopenRateBps(m: AgentRow): number | null {
  const handled = Number(m.handled ?? 0);
  if (!Number.isFinite(handled) || handled <= 0) return null;
  return Math.round((Number(m.reopenedCount ?? 0) / handled) * 10000);
}

/** Busiest first — the load-balance question the canon's second panel asks. */
export function sortAgentsByLoad(rows: readonly AgentRow[]): AgentRow[] {
  return [...rows].sort((a, b) => (b.handled ?? 0) - (a.handled ?? 0));
}

// ---------------------------------------------------------------------------
// CSAT (W056)
// ---------------------------------------------------------------------------
export interface CsatBucket { score?: number; n?: number }

/** Share of each score, in basis points of the rated total. Returns an empty list when nothing was rated rather than
 *  five zeroes, which would draw a chart implying everybody scored 1. */
export function csatShares(buckets: readonly CsatBucket[]): Array<{ score: number; n: number; shareBps: number }> {
  const total = buckets.reduce((a, b) => a + Number(b.n ?? 0), 0);
  if (total <= 0) return [];
  return buckets.map((b) => ({
    score: Number(b.score ?? 0), n: Number(b.n ?? 0),
    shareBps: Math.round((Number(b.n ?? 0) / total) * 10000),
  }));
}

/** Scores at or below this are the review queue — the only part of a CSAT dashboard anybody acts on. */
export const LOW_SCORE_MAX = 3;
export function isLowScore(score: number | null | undefined): boolean {
  const s = Number(score);
  return Number.isFinite(s) && s > 0 && s <= LOW_SCORE_MAX;
}

// ---------------------------------------------------------------------------
// SLA matrix (W054)
// ---------------------------------------------------------------------------
export interface SlaRow { severity?: string; firstResponseMinutes?: number; resolutionMinutes?: number }

/** Minutes as something a human reads at a glance. */
export function humanMinutes(min: number | null | undefined): string {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m < 60) return `${m}m`;
  if (m % 60 === 0 && m < 1440) return `${m / 60}h`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  const d = m / 1440;
  return Number.isInteger(d) ? `${d}d` : `${(m / 60).toFixed(0)}h`;
}

/** Is the matrix coherent — do targets loosen as severity falls? A matrix where P1 has longer to respond than P2 is a
 *  configuration mistake that would quietly mis-prioritise every ticket, so the page checks rather than assumes. */
export function matrixIsCoherent(rows: readonly SlaRow[]): boolean {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]; const cur = rows[i];
    if (Number(cur.firstResponseMinutes) <= Number(prev.firstResponseMinutes)) return false;
    if (Number(cur.resolutionMinutes) <= Number(prev.resolutionMinutes)) return false;
  }
  return rows.length > 0;
}
