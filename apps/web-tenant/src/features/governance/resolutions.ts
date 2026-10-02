// apps/web-tenant/src/features/governance/resolutions.ts · PC-56 TENANT-9b · THE RESOLUTIONS, in the console. PURE.
//
// W198 (`/governance/resolutions`; canon slug `insights/governance/resolutions`, the live governance area kept), the form
// chain W2741–W2744 (`/governance/resolutions/new` — create, and edit while a draft) and the mutate chain W2745–W2747
// (`/governance/resolutions/[id]/act` — open · close · withdraw). Every list here is the API's own (the console spec reads
// the API source and the migration and asserts they agree); every word is a key (Law 7); every refusal is a sentence.
//
// THE RULE THIS FILE EXISTS FOR (F-13): a CLOSED resolution's result is its SNAPSHOT — the roll recorded at close, the rule
// fixed when voting opened and the outcome the DATABASE wrote — or "not recorded". Nothing here recomputes a result.
export const RESOLUTIONS_HREF = '/governance/resolutions';
export const NEW_RESOLUTION_HREF = '/governance/resolutions/new';
export const REGISTER_HREF = '/governance/register';

export const RESOLUTION_TYPES = ['agm_vote', 'dividend', 'patronage_bonus', 'board_election'] as const;
export const RESOLUTION_STATUSES = ['draft', 'open', 'closed', 'withdrawn'] as const;
export const MAJORITIES = ['ordinary', 'special'] as const;
export const RESOLUTION_ACTS = ['open', 'close', 'withdraw'] as const;
export type ResolutionActCode = (typeof RESOLUTION_ACTS)[number];
export const OUTCOMES = ['passed', 'failed', 'not_recorded'] as const;
export const RESULT_BASES = ['live', 'snapshot', 'not_recorded', 'none'] as const;
export const FORMULA_MODES = ['equal_split', 'patronage_pro_rata', 'per_share_rate', 'patronage_pct'] as const;
export const DRAFT_FIELDS = ['title', 'body', 'resolutionType', 'majority', 'votingOpens', 'votingCloses',
  'formulaMode', 'potAmount', 'ratePct', 'capAmount', 'fiscalYear'] as const;
export type DraftFieldName = (typeof DRAFT_FIELDS)[number];
/** The API's draft refusals (domain/resolution-rules.ts DraftRefusalCode), plus the transport ones a write can carry. */
export const DRAFT_REFUSALS = ['NO_PERMISSION', 'NOT_A_DRAFT', 'TITLE_REQUIRED', 'TITLE_TOO_SHORT', 'TOO_LONG', 'TEXT_HAS_MARKUP', 'TYPE_REQUIRED',
  'TYPE_UNKNOWN', 'BOARD_ELECTION_NOT_MODELLED', 'MAJORITY_UNKNOWN', 'DATE_INVALID', 'WINDOW_ORDER', 'CLOSES_IN_PAST',
  'FORMULA_REQUIRED', 'FORMULA_NOT_FOR_TYPE', 'FORMULA_MODE', 'POT_INVALID', 'RATE_INVALID', 'CAP_INVALID',
  'FISCAL_YEAR_INVALID', 'FY_NOT_DECLARED', 'CURRENCY_UNKNOWN', 'FIELD_NOT_FOR_MODE'] as const;
/** The API's act refusals (ActRefusal), plus the database's own word when its wall said no. */
export const ACT_REFUSALS = ['NO_PERMISSION', 'NOT_A_DRAFT', 'NOT_OPEN', 'ALREADY_DECIDED', 'BOARD_ELECTION_NOT_MODELLED', 'WINDOW_ALREADY_ENDED',
  'SECOND_PERSON_REQUIRED', 'REASON_REQUIRED', 'REASON_UNKNOWN', 'WINDOW_NOT_ENDED', 'NOTE_REQUIRED', 'NOTE_TOO_LONG'] as const;
export const TRANSPORT_CODES = ['DATABASE_REFUSED', 'GOVERNANCE_REFUSED', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'unknown'] as const;
export const CLOSE_REASONS = ['window_ended', 'all_have_voted', 'agm_declared'] as const;
export const WITHDRAW_REASONS = ['drafting_error', 'superseded', 'legal_advice', 'board_decision'] as const;
export const VOTE_CHOICES = ['for', 'against', 'abstain'] as const;
/** Mirrors the API's MIN_NOTE / MAX_NOTE, so the form says the bound before the route does. */
export const MIN_NOTE = 3;
export const MAX_NOTE = 300;

/**
 * What W198 draws that this platform cannot stand behind — each printed on the page with its reason, never hidden and
 * never faked. `retry` is the canon's own act on the mutate chain: a re-read, not a mutation.
 */
export const RESOLUTIONS_REFUSED_BY_NAME = ['smsVoice', 'noticePeriod', 'voiceReadout', 'paperBallot', 'board', 'boardElection',
  'perLanguageText', 'autoClose', 'closingSoon', 'memberApp', 'payoutConsole', 'smsResult', 'retry'] as const;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isResolutionStatus = (v: unknown) => has(RESOLUTION_STATUSES, v);
export const isResolutionType = (v: unknown) => has(RESOLUTION_TYPES, v);
export const isResolutionAct = (v: unknown): v is ResolutionActCode => has(RESOLUTION_ACTS, v);

/* ---------------------------------------------------------------------------------------------------------- */
/* HREFS AND THE GET-FORM FILTERS                                                                             */
/* ---------------------------------------------------------------------------------------------------------- */

export interface ListFilters { status?: string; type?: string; year?: number; cursor?: string }

/** Unknown values are NO filter, never an error and never passed through. */
export function listFilters(sp: Record<string, string | string[] | undefined>): ListFilters {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).trim() : '');
  const out: ListFilters = {};
  if (isResolutionStatus(one('status'))) out.status = one('status');
  if (isResolutionType(one('type'))) out.type = one('type');
  const y = one('year');
  if (/^\d{4}$/.test(y) && Number(y) >= 2000 && Number(y) <= 2100) out.year = Number(y);
  const c = one('cursor');
  if (c && c.length <= 200 && /^[A-Za-z0-9_-]+$/.test(c)) out.cursor = c;
  return out;
}

export function listHref(f: Omit<ListFilters, 'cursor'>, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (f.status) q.set('status', f.status);
  if (f.type) q.set('type', f.type);
  if (f.year) q.set('year', String(f.year));
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${RESOLUTIONS_HREF}?${s}` : RESOLUTIONS_HREF;
}

export const actHref = (id: string, act: ResolutionActCode) => `${RESOLUTIONS_HREF}/${encodeURIComponent(id)}/act?step=confirm&act=${act}`;
export const editHref = (id: string) => `${NEW_RESOLUTION_HREF}?step=edit&id=${encodeURIComponent(id)}`;
export const resultsHref = (id: string) => `${RESOLUTIONS_HREF}?id=${encodeURIComponent(id)}#r-${encodeURIComponent(id)}`;

/** The acts a resolution in this status offers — the API's state machine (domain/resolution.state.ts), mirrored. */
export function actsFor(status: string): ResolutionActCode[] {
  if (status === 'draft') return ['open', 'withdraw'];
  if (status === 'open') return ['close', 'withdraw'];
  return [];
}
/** W198's "Retry" (couldn't load) is a PAGE LOAD — the mutate chain is for state changes (the 7d/9c ruling). */
export function retryIsMutation(): false { return false; }

/* ---------------------------------------------------------------------------------------------------------- */
/* KEYS                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------- */

export const typeKey = (t: string) => (isResolutionType(t) ? `res.type.${t}` : 'res.type.other');
export const statusKey = (s: string) => (isResolutionStatus(s) ? `res.status.${s}` : 'res.status.other');
export const outcomeKey = (o: string | null | undefined) => (has(OUTCOMES, o) ? `res.outcome.${o}` : 'res.outcome.none');
export const basisKey = (b: string | null | undefined) => (has(RESULT_BASES, b) ? `res.basis.${b}` : 'res.basis.none');
export const majorityKey = (m: string) => (has(MAJORITIES, m) ? `res.majority.${m}` : 'res.majority.ordinary');
export const fieldKey = (f: string) => `res.field.${f}`;
export const actKey = (a: string) => (isResolutionAct(a) ? `res.act.${a}` : 'res.act.other');
export const formulaModeKey = (m: string) => (has(FORMULA_MODES, m) ? `res.formula.${m}` : 'res.formula.other');
export const choiceKey = (c: string) => (has(VOTE_CHOICES, c) ? `res.choice.${c}` : 'res.choice.other');
export function reasonKey(act: string, code: string): string {
  if (act === 'close' && has(CLOSE_REASONS, code)) return `res.reason.close.${code}`;
  if (act === 'withdraw' && has(WITHDRAW_REASONS, code)) return `res.reason.withdraw.${code}`;
  return 'res.reason.other';
}
/** One refusal code → one sentence; an unknown code says "unknown" (never a raw key on the screen). */
export function refusalKey(code: string): string {
  return has(DRAFT_REFUSALS, code) || has(ACT_REFUSALS, code) || has(TRANSPORT_CODES, code) ? `res.refusal.${code}` : 'res.refusal.unknown';
}

/** The API's state for a failed read, as a page state: flagged off (404 on a list), restricted, not found, or broken. */
export function govState(code: string | undefined, status?: number, list = false): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return list ? 'flaggedOff' : 'notFound';
  return 'error';
}

/** The refusal codes a failed write carries (GOVERNANCE_REFUSED's details), only the ones that look like codes. */
export function refusalCodesFrom(details: unknown, fallback: string): string[] {
  const list = (details as { refusals?: unknown } | null)?.refusals;
  if (!Array.isArray(list)) return [fallback];
  const codes = list.map((r) => (r as { code?: unknown })?.code).filter((c): c is string => typeof c === 'string' && /^[A-Za-z_]{2,40}$/.test(c));
  return codes.length ? [...new Set(codes)] : [fallback];
}

/* ---------------------------------------------------------------------------------------------------------- */
/* NUMBERS A PAGE PRINTS — never decided here                                                                 */
/* ---------------------------------------------------------------------------------------------------------- */

/** Basis points as a whole-percent string, floored — "52%"; null stays null (unknown is not zero). */
export function bpPercent(bp: number | null | undefined): string | null {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return null;
  return `${Math.floor(bp / 100)}%`;
}
/** A pass rule in words: ordinary "more than 1/2 of votes cast", special "at least 2/3 of votes cast". */
export function ruleVars(r: { num: number; den: number; strict: boolean } | null | undefined): { key: string; vars: Record<string, string> } | null {
  if (!r) return null;
  return { key: r.strict ? 'res.rule.moreThan' : 'res.rule.atLeast', vars: { fraction: `${r.num}/${r.den}` } };
}

/** Minor units → a major-unit string at the currency's own scale (never ÷100 assumed). */
export function minorToMajor(minor: string, minorUnits: number): string | null {
  if (!/^\d+$/.test(minor) || !Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 6) return null;
  if (minorUnits === 0) return minor.replace(/^0+(?=\d)/, '');
  const p = minor.padStart(minorUnits + 1, '0');
  return `${p.slice(0, -minorUnits).replace(/^0+(?=\d)/, '')}.${p.slice(-minorUnits)}`;
}

/**
 * A stored formula, as a sentence key + vars — W198: "payload: 1.2% of member's FY sales, cap ₹2,500/member". The money
 * carries its ISO code (TENANT-6d-7: one glyph is not right in every script). `null` = nothing to print (a motion).
 */
export function formulaLine(payload: Record<string, unknown> | null | undefined, currency: { code: string; minorUnits: number } | null):
  { key: string; vars: Record<string, string> } | null {
  if (!payload || typeof payload !== 'object') return null;
  const mode = String((payload as { mode?: unknown }).mode ?? '');
  const code = String((payload as { currencyCode?: unknown }).currencyCode ?? currency?.code ?? '');
  const money = (m: unknown) => (typeof m === 'string' && currency ? `${code} ${minorToMajor(m, currency.minorUnits) ?? m}` : null);
  const rate = (bp: unknown) => (typeof bp === 'number' ? `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%` : null);
  if (mode === 'equal_split' || mode === 'patronage_pro_rata') {
    const pot = money((payload as { potMinor?: unknown }).potMinor);
    return pot ? { key: `res.formulaLine.${mode}`, vars: { pot } } : null;
  }
  if (mode === 'per_share_rate') {
    const r = rate((payload as { rateBp?: unknown }).rateBp);
    return r ? { key: 'res.formulaLine.per_share_rate', vars: { rate: r } } : null;
  }
  if (mode === 'patronage_pct') {
    const r = rate((payload as { rateBp?: unknown }).rateBp);
    const fy = (payload as { fiscalYear?: unknown }).fiscalYear;
    const cap = money((payload as { capMinor?: unknown }).capMinor);
    if (!r || typeof fy !== 'number') return null;
    return cap ? { key: 'res.formulaLine.patronage_pct_cap', vars: { rate: r, fy: String(fy), cap } }
               : { key: 'res.formulaLine.patronage_pct', vars: { rate: r, fy: String(fy) } };
  }
  return null;
}

/** The form's values, carried in the URL between edit and review (6d-4's shape) — only the declared fields. */
export function draftValues(sp: Record<string, string | string[] | undefined>): Record<DraftFieldName, string> {
  const out = {} as Record<DraftFieldName, string>;
  for (const f of DRAFT_FIELDS) {
    const v = sp[f];
    out[f] = typeof v === 'string' ? v.slice(0, f === 'body' ? 10_000 : 300) : '';
  }
  return out;
}

/** The draft's stored values in the form's own shape (the edit prefill) — money back to major units at the scale. */
export function prefillFrom(d: { title: string; body: string | null; resolutionType: string; majority: string; votingOpens: string | null;
  votingCloses: string | null; payload: Record<string, unknown> }, currency: { code: string; minorUnits: number } | null): Record<DraftFieldName, string> {
  const p = d.payload ?? {};
  const mode = typeof p.mode === 'string' ? p.mode : '';
  const major = (m: unknown) => (typeof m === 'string' && currency ? minorToMajor(m, currency.minorUnits) ?? '' : '');
  const rate = typeof p.rateBp === 'number' ? (p.rateBp / 100).toFixed(2).replace(/\.?0+$/, '') : '';
  return {
    title: d.title, body: d.body ?? '', resolutionType: d.resolutionType, majority: d.majority,
    votingOpens: d.votingOpens ?? '', votingCloses: d.votingCloses ?? '', formulaMode: mode,
    potAmount: major(p.potMinor), ratePct: rate, capAmount: major(p.capMinor),
    fiscalYear: typeof p.fiscalYear === 'number' ? String(p.fiscalYear) : '',
  };
}

/** The draft chain carries a resolution's body (≤ 10,000) between edit and review — its own ceiling, 7b's precedent. */
export const MAX_CARRIED_RESOLUTION = 12_000;
/** Which money fields each formula mode reads (the API's MODE_FIELDS, mirrored — the form draws only these). */
export const MODE_FIELDS: Record<string, DraftFieldName[]> = {
  equal_split: ['potAmount'],
  patronage_pro_rata: ['potAmount'],
  per_share_rate: ['ratePct'],
  patronage_pct: ['ratePct', 'capAmount', 'fiscalYear'],
};
