// modules/memberships/domain/resolution-rules.ts · PC-56 TENANT-9b · THE RESOLUTION, AS RULES. PURE.
//
// W198: *"Resolution lifecycle recorded · votes immutable after close · results published to all members"*. Before this
// wave the lifecycle was two buttons that wrote a status and nothing else, a closed resolution's result was recomputed
// against TODAY's roll and TODAY's bylaws (F-13), and any 1–20 character string was a ballot. This file is the one place
// the API decides:
//   • the VOCABULARY — the canon's four subjects, two majority rules, the declared ballot choices per subject (as DATA,
//     0182's `resolution_choice`; `board_election` declares none — candidates are refused by name, no table models them);
//   • the RULE a resolution is decided by — quorum (0130) and the pass fraction (ordinary: more than half of cast; special:
//     at least the tenant's declared fraction, 0182) — fixed when voting OPENS and never re-read for a closed resolution;
//   • the RESULT — `outcomeOf` mirrors 0182's `coop_resolution_outcome` exactly (a spec asserts the two agree over a fact
//     matrix); for a CLOSED resolution the page prints the database's recorded outcome and the snapshot's numbers, and a
//     resolution closed before the snapshot existed prints "not recorded" — never a number computed from today;
//   • the ACTS — open, close, withdraw — as one verdict function, in the order a person wants to hear it (permission →
//     state → rule → second person → reason), so no button 403s and the confirm page says WHY;
//   • the DRAFT REVIEW — what the platform will store, normalised, with every refusal (shared/form-review's contract).
import { field, ReviewField, ReviewRefusal, reviewResult, ReviewResult, ReviewDiffRow } from '../../../shared/form-review';
import { parseMajorToMinor, minorToMajorText } from '../../../core/money/major-minor';
import { parseFormula, CoopFormula, FORMULA_MODES } from './coop-payout.rules';
import type { Bylaws, Tally, VoteRow } from './voting-eligibility';
import { canMove, isFinal } from './resolution.state';

export const RESOLUTION_TYPES = ['agm_vote', 'dividend', 'patronage_bonus', 'board_election'] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];
export const RESOLUTION_STATUSES = ['draft', 'open', 'closed', 'withdrawn'] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];
export const MAJORITIES = ['ordinary', 'special'] as const;
export type Majority = (typeof MAJORITIES)[number];
export const RESOLUTION_ACTS = ['open', 'close', 'withdraw'] as const;
export type ResolutionAct = (typeof RESOLUTION_ACTS)[number];
export const OUTCOMES = ['passed', 'failed', 'not_recorded'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const isResolutionType = (v: unknown): v is ResolutionType => typeof v === 'string' && (RESOLUTION_TYPES as readonly string[]).includes(v);
export const isResolutionStatus = (v: unknown): v is ResolutionStatus => typeof v === 'string' && (RESOLUTION_STATUSES as readonly string[]).includes(v);
export const isResolutionAct = (v: unknown): v is ResolutionAct => typeof v === 'string' && (RESOLUTION_ACTS as readonly string[]).includes(v);

/** The reason a note must carry, in characters (6d-5's mutate bounds). */
export const MIN_NOTE = 3;
export const MAX_NOTE = 300;
export const MIN_TITLE = 3;
export const MAX_TITLE = 250;
export const MAX_BODY = 10_000;

/** What the database declares (0182 lookup rows), read by the service and handed in — never compiled in. */
export interface GovernanceCatalogue {
  types: Array<{ code: string; dividendClass: boolean; modelled: boolean }>;
  choices: Array<{ code: string; types: string[]; inFavour: boolean }>;
  closeReasons: string[];
  withdrawReasons: string[];
}

export function typeInfo(cat: GovernanceCatalogue, type: string) { return cat.types.find((t) => t.code === type) ?? null; }
export function isDividendClass(cat: GovernanceCatalogue, type: string): boolean { return typeInfo(cat, type)?.dividendClass === true; }
/** The choices a ballot of this type accepts — empty for a type whose ballot is not modelled. */
export function choicesFor(cat: GovernanceCatalogue, type: string): string[] {
  return cat.choices.filter((c) => c.types.includes(type)).map((c) => c.code);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE RULE                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

export interface PassRule { quorumBp: number; num: number; den: number; strict: boolean }
export const DEFAULT_SPECIAL = { num: 2, den: 3 };

/**
 * The special-majority fraction from tenant settings (0182). **A MALFORMED SETTING FALLS BACK TO TWO-THIRDS, NEVER TO A
 * SIMPLE MAJORITY** — 0130's direction: a broken setting must never open a gate. A fraction at or below one half is not a
 * special majority, and one at or above all is unreachable by abstention alone; both are refused.
 */
export function specialMajorityFrom(raw: Record<string, unknown> | null | undefined): { num: number; den: number } {
  const int = (v: unknown) => { const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN; return Number.isInteger(n) ? n : Number.NaN; };
  const num = int(raw?.['governance.special_majority_num']);
  const den = int(raw?.['governance.special_majority_den']);
  if (!Number.isInteger(num) || !Number.isInteger(den) || num < 1 || den < 2 || num >= den || num * 2 <= den) return { ...DEFAULT_SPECIAL };
  return { num, den };
}

/** Ordinary: MORE than half of cast (1e's `inFavour × 2 > cast`). Special: AT LEAST the declared fraction. */
export function passRuleFor(majority: Majority, bylaws: Pick<Bylaws, 'quorumBp'>, special: { num: number; den: number }): PassRule {
  return majority === 'special'
    ? { quorumBp: bylaws.quorumBp, num: special.num, den: special.den, strict: false }
    : { quorumBp: bylaws.quorumBp, num: 1, den: 2, strict: true };
}

export function carries(inFavour: number, cast: number, rule: Pick<PassRule, 'num' | 'den' | 'strict'>): boolean {
  return rule.strict ? inFavour * rule.den > cast * rule.num : inFavour * rule.den >= cast * rule.num;
}

/**
 * THE RESULT — 0182's `coop_resolution_outcome`, line for line. `not_recorded` when any part of the snapshot is missing.
 * Zero ballots, or nobody eligible, is `failed` (nothing carried) — not "no result", because a closed resolution decided.
 */
export function outcomeOf(byChoice: readonly VoteRow[], inFavourCodes: readonly string[], eligible: number | null, rule: PassRule | null): Outcome {
  if (eligible === null || rule === null) return 'not_recorded';
  const cast = byChoice.reduce((n, r) => n + r.votes, 0);
  const inFavour = byChoice.filter((r) => inFavourCodes.includes(r.choice)).reduce((n, r) => n + r.votes, 0);
  if (cast === 0 || eligible <= 0) return 'failed';
  const turnout = Math.floor((cast * 10_000) / eligible);
  if (turnout < rule.quorumBp) return 'failed';
  return carries(inFavour, cast, rule) ? 'passed' : 'failed';
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE RESULT A PAGE PRINTS                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

export interface ResolutionSnapshot {
  status: string;
  eligibleAtClose: number | null;
  rule: PassRule | null;
  ruleFixedAt: 'open' | 'close' | null;
  outcome: string | null;
}

export type ResultBasis = 'live' | 'snapshot' | 'not_recorded' | 'none';

export interface ResultView {
  /** live = an open vote counted against today's roll (it IS today's vote); snapshot = a closed vote, its own numbers;
   *  not_recorded = closed before the snapshot existed; none = a draft or a withdrawn resolution (nothing was decided). */
  basis: ResultBasis;
  tally: Tally | null;
  rule: PassRule | null;
  ruleFixedAt: 'open' | 'close' | null;
  outcome: Outcome | null;
  /** True only when the recorded outcome and this arithmetic disagree — impossible while 0182's trigger stands; printed
   *  rather than hidden if it ever happens. */
  disagreement: boolean;
}

function tallyUnder(byChoice: readonly VoteRow[], inFavourCodes: readonly string[], eligible: number, rule: PassRule): Tally {
  const cast = byChoice.reduce((n, r) => n + r.votes, 0);
  const inFavour = byChoice.filter((r) => inFavourCodes.includes(r.choice)).reduce((n, r) => n + r.votes, 0);
  const turnoutBp = eligible > 0 ? Math.floor((cast * 10_000) / eligible) : 0;
  const quorumMet = eligible > 0 && turnoutBp >= rule.quorumBp;
  return {
    cast, eligible, turnoutBp, quorumBp: rule.quorumBp, quorumMet,
    byChoice: [...byChoice].sort((a, b) => b.votes - a.votes || a.choice.localeCompare(b.choice)),
    inFavourBp: cast > 0 ? Math.floor((inFavour * 10_000) / cast) : null,
    passed: cast > 0 && eligible > 0 ? (quorumMet && carries(inFavour, cast, rule)) : null,
  };
}

/**
 * **A CLOSED RESOLUTION IS READ FROM ITS SNAPSHOT AND NOTHING ELSE.** `liveEligible` / `liveRule` are used ONLY for an open
 * resolution — the one whose vote is still today's. F-13's defect was exactly the absence of this branch.
 */
export function resultView(s: ResolutionSnapshot, byChoice: readonly VoteRow[], inFavourCodes: readonly string[],
                           liveEligible: number | null, liveRule: PassRule): ResultView {
  if (s.status === 'open') {
    const rule = s.rule ?? liveRule;
    const eligible = liveEligible ?? 0;
    return { basis: 'live', tally: tallyUnder(byChoice, inFavourCodes, eligible, rule), rule, ruleFixedAt: s.ruleFixedAt, outcome: null, disagreement: false };
  }
  if (s.status === 'closed') {
    if (s.eligibleAtClose === null || s.rule === null || s.outcome === 'not_recorded' || s.outcome === null) {
      // Turnout is printable when the denominator was recorded (0130–0182), the result is not (no rule was recorded).
      const tally = s.eligibleAtClose === null ? null : tallyUnder(byChoice, inFavourCodes, s.eligibleAtClose, s.rule ?? { quorumBp: 0, num: 1, den: 2, strict: true });
      return { basis: 'not_recorded', tally: tally ? { ...tally, quorumBp: s.rule?.quorumBp ?? 0, quorumMet: false, passed: null } : null,
               rule: s.rule, ruleFixedAt: s.ruleFixedAt, outcome: 'not_recorded', disagreement: false };
    }
    const tally = tallyUnder(byChoice, inFavourCodes, s.eligibleAtClose, s.rule);
    const recorded = s.outcome as Outcome;
    const computed = outcomeOf(byChoice, inFavourCodes, s.eligibleAtClose, s.rule);
    return { basis: 'snapshot', tally, rule: s.rule, ruleFixedAt: s.ruleFixedAt, outcome: recorded, disagreement: computed !== recorded };
  }
  return { basis: 'none', tally: null, rule: s.rule, ruleFixedAt: s.ruleFixedAt, outcome: null, disagreement: false };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE BALLOT                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

export type BallotRefusal = 'BOARD_ELECTION_NOT_MODELLED' | 'CHOICE_UNDECLARED';

/** "Any word is a ballot" (F-13) — a choice must be DECLARED for the resolution's type. */
export function ballotVerdict(cat: GovernanceCatalogue, type: string, choice: string): BallotRefusal | null {
  const info = typeInfo(cat, type);
  if (info && !info.modelled) return 'BOARD_ELECTION_NOT_MODELLED';
  return choicesFor(cat, type).includes(choice) ? null : 'CHOICE_UNDECLARED';
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE ACTS                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

export type ActRefusal =
  | 'NO_PERMISSION' | 'NOT_A_DRAFT' | 'NOT_OPEN' | 'ALREADY_DECIDED' | 'BOARD_ELECTION_NOT_MODELLED' | 'WINDOW_ALREADY_ENDED'
  | 'SECOND_PERSON_REQUIRED' | 'REASON_REQUIRED' | 'REASON_UNKNOWN' | 'WINDOW_NOT_ENDED' | 'NOTE_REQUIRED' | 'NOTE_TOO_LONG';

export interface ActSubject {
  status: string; resolutionType: string; majority: string; votingCloses: string | null; openedBy: string | null;
}

export interface ActVerdict { act: ResolutionAct; allowed: boolean; refusals: ActRefusal[]; secondPerson: boolean }

/** Does closing this resolution need a person other than its opener? Special majority, or money (dividend-class). */
export function needsSecondPerson(cat: GovernanceCatalogue, s: Pick<ActSubject, 'majority' | 'resolutionType'>): boolean {
  return s.majority === 'special' || isDividendClass(cat, s.resolutionType);
}

export function actVerdict(act: ResolutionAct, s: ActSubject, actor: { userId: string; canManage: boolean },
                           input: { reasonCode?: string | null; note?: string | null }, cat: GovernanceCatalogue, now: Date): ActVerdict {
  const refusals: ActRefusal[] = [];
  const second = act === 'close' && needsSecondPerson(cat, s);
  if (!actor.canManage) refusals.push('NO_PERMISSION');
  if (isFinal(s.status)) refusals.push('ALREADY_DECIDED');
  else if (!canMove(act, s.status)) refusals.push(act === 'open' ? 'NOT_A_DRAFT' : 'NOT_OPEN');
  if (act === 'open') {
    if (typeInfo(cat, s.resolutionType)?.modelled === false) refusals.push('BOARD_ELECTION_NOT_MODELLED');
    if (s.votingCloses && Date.parse(s.votingCloses) <= now.getTime()) refusals.push('WINDOW_ALREADY_ENDED');
  }
  const reason = (input.reasonCode ?? '').trim();
  if (act === 'close' || act === 'withdraw') {
    const vocab = act === 'close' ? cat.closeReasons : cat.withdrawReasons;
    if (!reason) refusals.push('REASON_REQUIRED');
    else if (!vocab.includes(reason)) refusals.push('REASON_UNKNOWN');
    // "The voting window has ended" is a claim about a clock — it is refused while the clock disagrees.
    else if (act === 'close' && reason === 'window_ended' && (!s.votingCloses || Date.parse(s.votingCloses) > now.getTime())) refusals.push('WINDOW_NOT_ENDED');
  }
  if (second && s.openedBy !== null && s.openedBy === actor.userId) refusals.push('SECOND_PERSON_REQUIRED');
  const note = (input.note ?? '').trim();
  if (note.length < MIN_NOTE) refusals.push('NOTE_REQUIRED');
  else if (note.length > MAX_NOTE) refusals.push('NOTE_TOO_LONG');
  return { act, allowed: refusals.length === 0, refusals, secondPerson: second };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE DRAFT REVIEW (W2741–W2744)                                                                               */
/* ------------------------------------------------------------------------------------------------------------ */

export const DRAFT_FIELDS = ['title', 'body', 'resolutionType', 'majority', 'votingOpens', 'votingCloses',
  'formulaMode', 'potAmount', 'ratePct', 'capAmount', 'fiscalYear'] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];
export type DraftInput = Partial<Record<DraftField, string | null>>;

export interface DraftFacts {
  canManage: boolean;
  catalogue: GovernanceCatalogue;
  zone: string;
  currency: { code: string; minorUnits: number } | null;
  /** The cooperative's declared fiscal-year start month (0181) — NULL = not declared. */
  fyMonth: number | null;
  bylaws: Pick<Bylaws, 'quorumBp'>;
  special: { num: number; den: number };
  /** The civil window, turned into instants BY THE DATABASE in the cooperative's zone (null = not given / invalid). */
  opensAt: string | null;
  closesAt: string | null;
  now: Date;
  /** Edit: the resolution as it stands (its civil window in the zone, its payload). */
  current: null | { status: string; title: string; body: string | null; resolutionType: string; majority: string;
    votingOpensCivil: string | null; votingClosesCivil: string | null; payload: Record<string, unknown> };
}

export type DraftRefusalCode =
  | 'NO_PERMISSION' | 'NOT_A_DRAFT' | 'TITLE_REQUIRED' | 'TITLE_TOO_SHORT' | 'TOO_LONG' | 'TEXT_HAS_MARKUP' | 'TYPE_REQUIRED'
  | 'TYPE_UNKNOWN' | 'BOARD_ELECTION_NOT_MODELLED' | 'MAJORITY_UNKNOWN' | 'DATE_INVALID' | 'WINDOW_ORDER' | 'CLOSES_IN_PAST'
  | 'FORMULA_REQUIRED' | 'FORMULA_NOT_FOR_TYPE' | 'FORMULA_MODE' | 'POT_INVALID' | 'RATE_INVALID' | 'CAP_INVALID'
  | 'FISCAL_YEAR_INVALID' | 'FY_NOT_DECLARED' | 'CURRENCY_UNKNOWN' | 'FIELD_NOT_FOR_MODE';

export interface DraftReview extends ReviewResult {
  /** The ballot members will see for this type (0182's declared choices), empty for an unmodelled type. */
  choices: string[];
  /** The rule the resolution WILL be decided by — fixed when voting opens (today's settings, shown now). */
  rule: PassRule | null;
  secondPersonToClose: boolean;
  window: { zone: string; opensCivil: string | null; closesCivil: string | null; opensAt: string | null; closesAt: string | null };
  /** The payload the writer stores — null for a type that pays nothing. */
  payload: Record<string, unknown> | null;
  formula: null | { mode: string; potMinor: string | null; rateBp: number | null; capMinor: string | null; fiscalYear: number | null;
    fiscalYearFrom: string | null; fiscalYearToExclusive: string | null; currency: string | null };
}

const MARKUP = /[<>]/;
export const CIVIL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A civil date-time the form can send (`datetime-local`), real on the calendar. */
export function isCivilDateTime(s: string): boolean {
  const m = CIVIL_DT.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** "1.2" → 120 basis points; at most two decimals; 0 < rate ≤ 100. */
export function pctToBp(s: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp >= 1 && bp <= 10_000 ? bp : null;
}
export function bpToPct(bp: number): string {
  const whole = Math.floor(bp / 100); const frac = bp % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** The cooperative's fiscal year `fy` (start year) as civil days: [from, toExclusive). */
export function fiscalYearWindow(fy: number, startMonth: number): { from: string; toExclusive: string } {
  const mm = String(startMonth).padStart(2, '0');
  return { from: `${fy}-${mm}-01`, toExclusive: `${fy + 1}-${mm}-01` };
}

const clean = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
};
const cleanBody = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const s = v.replace(/\r\n/g, '\n').trim();
  return s.length ? s : null;
};

/** Which money fields each formula mode reads — a value typed into a field the mode ignores is refused, not dropped. */
export const MODE_FIELDS: Record<string, DraftField[]> = {
  equal_split: ['potAmount'],
  patronage_pro_rata: ['potAmount'],
  per_share_rate: ['ratePct'],
  patronage_pct: ['ratePct', 'capAmount', 'fiscalYear'],
};

export function buildDraftReview(input: DraftInput, f: DraftFacts): DraftReview {
  const refusals: ReviewRefusal[] = [];
  const no = (fieldName: DraftField | null, code: DraftRefusalCode) => {
    if (!refusals.some((r) => r.field === fieldName && r.code === code)) refusals.push({ field: fieldName, code });
  };
  if (!f.canManage) no(null, 'NO_PERMISSION');
  if (f.current && f.current.status !== 'draft') no(null, 'NOT_A_DRAFT');

  const title = clean(input.title);
  if (!title) no('title', 'TITLE_REQUIRED');
  else if (title.length < MIN_TITLE) no('title', 'TITLE_TOO_SHORT');
  else if (title.length > MAX_TITLE) no('title', 'TOO_LONG');
  else if (MARKUP.test(title)) no('title', 'TEXT_HAS_MARKUP');

  const body = cleanBody(input.body);
  if (body !== null) {
    if (body.length > MAX_BODY) no('body', 'TOO_LONG');
    else if (MARKUP.test(body)) no('body', 'TEXT_HAS_MARKUP');
  }

  const type = clean(input.resolutionType);
  const info = type ? typeInfo(f.catalogue, type) : null;
  if (!type) no('resolutionType', 'TYPE_REQUIRED');
  else if (!info) no('resolutionType', 'TYPE_UNKNOWN');
  else if (!info.modelled) no('resolutionType', 'BOARD_ELECTION_NOT_MODELLED');

  const majorityRaw = clean(input.majority) ?? 'ordinary';
  const majority = (MAJORITIES as readonly string[]).includes(majorityRaw) ? (majorityRaw as Majority) : null;
  if (!majority) no('majority', 'MAJORITY_UNKNOWN');

  const opensCivil = clean(input.votingOpens); const closesCivil = clean(input.votingCloses);
  const opensOk = opensCivil === null || isCivilDateTime(opensCivil);
  const closesOk = closesCivil === null || isCivilDateTime(closesCivil);
  if (!opensOk) no('votingOpens', 'DATE_INVALID');
  if (!closesOk) no('votingCloses', 'DATE_INVALID');
  const opensAt = opensOk && opensCivil ? f.opensAt : null;
  const closesAt = closesOk && closesCivil ? f.closesAt : null;
  if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) no('votingCloses', 'WINDOW_ORDER');
  if (closesAt && Date.parse(closesAt) <= f.now.getTime()) no('votingCloses', 'CLOSES_IN_PAST');

  // THE FORMULA — W198: "payload formula → per-member amounts → payout batch". A dividend-class resolution that carries
  // no formula can never compute (F-14: the console's form had no payload field at all); one that pays nothing must not
  // carry one (a formula on an AGM motion is money nobody is deciding).
  const mode = clean(input.formulaMode);
  const dividend = info?.dividendClass === true;
  let payload: Record<string, unknown> | null = null;
  let formula: DraftReview['formula'] = null;
  const pot = clean(input.potAmount); const rate = clean(input.ratePct); const cap = clean(input.capAmount); const fyRaw = clean(input.fiscalYear);
  if (!dividend) {
    if (mode !== null) no('formulaMode', 'FORMULA_NOT_FOR_TYPE');
    for (const [n, v] of [['potAmount', pot], ['ratePct', rate], ['capAmount', cap], ['fiscalYear', fyRaw]] as const) if (v !== null) no(n, 'FORMULA_NOT_FOR_TYPE');
  } else if (info) {
    if (mode === null) no('formulaMode', 'FORMULA_REQUIRED');
    else if (!(FORMULA_MODES as readonly string[]).includes(mode)) no('formulaMode', 'FORMULA_MODE');
    else {
      const used = MODE_FIELDS[mode];
      for (const [n, v] of [['potAmount', pot], ['ratePct', rate], ['capAmount', cap], ['fiscalYear', fyRaw]] as const) {
        if (v !== null && !used.includes(n)) no(n, 'FIELD_NOT_FOR_MODE');
      }
      // Every dividend-class run pays in the cooperative's currency, at its scale — no scale, no money form.
      if (f.currency === null) no(null, 'CURRENCY_UNKNOWN');
      const candidate: Record<string, unknown> = { mode };
      if (used.includes('potAmount')) {
        const minor = pot && f.currency ? parseMajorToMinor(pot, f.currency.minorUnits) : null;
        if (!minor || /^0+$/.test(minor)) no('potAmount', 'POT_INVALID'); else candidate.potMinor = minor;
      }
      if (used.includes('ratePct')) {
        const bp = rate ? pctToBp(rate) : null;
        if (bp === null) no('ratePct', 'RATE_INVALID'); else candidate.rateBp = bp;
      }
      if (used.includes('capAmount') && cap !== null) {
        const minor = f.currency ? parseMajorToMinor(cap, f.currency.minorUnits) : null;
        if (!minor || /^0+$/.test(minor)) no('capAmount', 'CAP_INVALID'); else candidate.capMinor = minor;
      }
      let window: { from: string; toExclusive: string } | null = null;
      if (used.includes('fiscalYear')) {
        const fy = fyRaw && /^\d{4}$/.test(fyRaw) ? Number(fyRaw) : Number.NaN;
        if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) no('fiscalYear', 'FISCAL_YEAR_INVALID');
        else if (f.fyMonth === null) no('fiscalYear', 'FY_NOT_DECLARED');
        else { candidate.fiscalYear = fy; window = fiscalYearWindow(fy, f.fyMonth); }
      }
      // The writer's own parser is the last word: what it refuses, the review refuses.
      const modeFieldRefused = refusals.some((r) => r.field !== null && (used as readonly string[]).includes(r.field));
      if (!modeFieldRefused && f.currency !== null) {
        const parsed = parseFormula(candidate);
        if (parsed.ok) {
          const v: CoopFormula = parsed.value;
          payload = { ...v, currencyCode: f.currency.code };
          formula = {
            mode: v.mode, potMinor: 'potMinor' in v ? v.potMinor : null, rateBp: 'rateBp' in v ? v.rateBp : null,
            capMinor: v.mode === 'patronage_pct' ? v.capMinor : null, fiscalYear: v.mode === 'patronage_pct' ? v.fiscalYear : null,
            fiscalYearFrom: window?.from ?? null, fiscalYearToExclusive: window?.toExclusive ?? null, currency: f.currency.code,
          };
        } else no('formulaMode', 'FORMULA_MODE');
      }
    }
  }

  const stored: Record<DraftField, string | null> = {
    title, body, resolutionType: info ? type : type, majority: majority ?? majorityRaw,
    votingOpens: opensAt, votingCloses: closesAt,
    formulaMode: dividend ? mode : null,
    potAmount: formula?.potMinor && f.currency ? minorToMajorText(formula.potMinor, f.currency.minorUnits) : null,
    ratePct: formula?.rateBp ? bpToPct(formula.rateBp) : null,
    capAmount: formula?.capMinor && f.currency ? minorToMajorText(formula.capMinor, f.currency.minorUnits) : null,
    fiscalYear: formula?.fiscalYear ? String(formula.fiscalYear) : null,
  };
  const shown = (n: DraftField) => dividend || !['formulaMode', 'potAmount', 'ratePct', 'capAmount', 'fiscalYear'].includes(n)
    || refusals.some((r) => r.field === n);
  const fields: ReviewField[] = DRAFT_FIELDS.filter(shown).map((n) => field(n, input[n] ?? null, stored[n]));
  // The two window fields are entered as civil times in the cooperative's zone and stored as instants: that is a
  // normalisation the review must point at (`normalised`), and it does — the entered and stored values differ by shape.

  let diff: ReviewDiffRow[] | null = null;
  if (f.current) {
    const cur = f.current;
    const curFormula = parseFormula(cur.payload ?? {});
    const before: Partial<Record<DraftField, string | null>> = {
      title: cur.title, body: cur.body, resolutionType: cur.resolutionType, majority: cur.majority,
      votingOpens: cur.votingOpensCivil, votingCloses: cur.votingClosesCivil,
      formulaMode: curFormula.ok ? curFormula.value.mode : null,
    };
    const after: Partial<Record<DraftField, string | null>> = {
      title, body, resolutionType: type, majority: majority ?? majorityRaw, votingOpens: opensCivil, votingCloses: closesCivil,
      formulaMode: dividend ? mode : null,
    };
    diff = (Object.keys(before) as DraftField[]).filter((k) => (before[k] ?? null) !== (after[k] ?? null))
      .map((k) => ({ field: k, before: before[k] ?? null, after: after[k] ?? null }));
    if (JSON.stringify(cur.payload ?? {}) !== JSON.stringify(payload ?? {})) diff.push({ field: 'formula', before: JSON.stringify(cur.payload ?? {}), after: JSON.stringify(payload ?? {}) });
  }

  const base = reviewResult('coop_resolution', fields, refusals, diff);
  const rule = majority ? passRuleFor(majority, f.bylaws, f.special) : null;
  return {
    ...base,
    // A diff row named `formula` is not a field row; reviewResult only checks REFUSALS are printable, so this is fine.
    choices: type ? choicesFor(f.catalogue, type) : [],
    rule,
    secondPersonToClose: majority === 'special' || dividend,
    window: { zone: f.zone, opensCivil, closesCivil, opensAt, closesAt },
    payload,
    formula,
  };
}
