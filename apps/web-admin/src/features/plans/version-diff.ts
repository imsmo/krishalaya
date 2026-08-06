// apps/web-admin/src/features/plans/version-diff.ts · PURE "what changed since the last version" (PC-56 ADMIN-1c,
// canon W011's change-summary panel). No IO → unit-provable.
//
// WHY A DIFF AT ALL. A plan version is a PRICE LIST. Before publishing one, the person doing it needs to see exactly
// what they are changing — not a form full of numbers that look plausible. Every real pricing mistake is a number
// that looked plausible in isolation.
//
// PLAN VERSIONS ARE SEPARATE `plans` ROWS sharing a `code` with an increasing `version` (0002), so the "previous
// version" is the highest version below this one for the same code. That is resolved here rather than assumed to be
// `version - 1`: versions can be skipped, and diffing against a row that does not exist would silently show
// everything as "new".
//
// NOTHING IS COMPUTED ABOUT MONEY except equality. The diff reports "was X, now Y" — it never sums, never percentages
// a price rise, never says "12% more expensive". A percentage would be arithmetic on money for presentation, and the
// number a pricing conversation needs is the actual price on the actual invoice.

export interface VersionRow {
  id: string;
  code: string;
  version: number;
  defaultName?: string | null;
  monthlyPriceMinor?: string | null;
  annualPriceMinor?: string | null;
  setupFeeMinor?: string | null;
  isPublic?: boolean | null;
  currency?: string | null;
  status?: string | null;
  features?: Array<{ code: string; isIncluded: boolean }>;
  limits?: Record<string, string>;
}

/** The previous version of the same plan code: the highest version strictly below `current`. Null when this is the
 *  first version — which the page says explicitly, because "nothing changed" and "there is nothing to compare
 *  against" are different statements. */
export function previousVersion(current: VersionRow, all: readonly VersionRow[]): VersionRow | null {
  const siblings = all
    .filter((p) => p.code === current.code && p.version < current.version && p.id !== current.id)
    .sort((a, b) => b.version - a.version);
  return siblings[0] ?? null;
}

export type MoneyField = 'monthlyPriceMinor' | 'annualPriceMinor' | 'setupFeeMinor';
export interface FieldChange { field: string; from: string | null; to: string | null }

const MONEY_FIELDS: MoneyField[] = ['monthlyPriceMinor', 'annualPriceMinor', 'setupFeeMinor'];

/** Money and flag changes. A field missing on either side is reported as null rather than as "0", so an absent price
 *  never reads as free. */
export function fieldChanges(from: VersionRow, to: VersionRow): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of MONEY_FIELDS) {
    const a = norm(from[f]); const b = norm(to[f]);
    if (a !== b) out.push({ field: f, from: a, to: b });
  }
  if (norm(from.defaultName) !== norm(to.defaultName)) {
    out.push({ field: 'defaultName', from: norm(from.defaultName), to: norm(to.defaultName) });
  }
  if ((from.isPublic === true) !== (to.isPublic === true)) {
    out.push({ field: 'isPublic', from: String(from.isPublic === true), to: String(to.isPublic === true) });
  }
  // A currency change between versions of the same code is not a price change, it is a different product — surfaced
  // as a change so it cannot pass unnoticed in a list of numbers.
  if (norm(from.currency) !== norm(to.currency)) {
    out.push({ field: 'currency', from: norm(from.currency), to: norm(to.currency) });
  }
  return out;
}

function norm(v: unknown): string | null {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s ? s : null;
}

export interface FeatureDelta { added: string[]; removed: string[]; excluded: string[]; included: string[] }

/**
 * Feature changes, split four ways because they mean four different things to a customer:
 *   • `added`    — a feature code that did not appear at all before,
 *   • `removed`  — one that has disappeared from the plan definition,
 *   • `included` — present before but switched ON,
 *   • `excluded` — present before and switched OFF (the one that generates support tickets).
 * Collapsing these into "changed" would hide the only one that takes something away from a tenant.
 */
export function featureDelta(from: VersionRow, to: VersionRow): FeatureDelta {
  const a = new Map((from.features ?? []).map((f) => [f.code, f.isIncluded === true]));
  const b = new Map((to.features ?? []).map((f) => [f.code, f.isIncluded === true]));
  const added: string[] = []; const removed: string[] = []; const included: string[] = []; const excluded: string[] = [];
  for (const [code, on] of b) {
    if (!a.has(code)) { added.push(code); continue; }
    const was = a.get(code) === true;
    if (was !== on) (on ? included : excluded).push(code);
  }
  for (const code of a.keys()) if (!b.has(code)) removed.push(code);
  return { added: added.sort(), removed: removed.sort(), included: included.sort(), excluded: excluded.sort() };
}

export interface LimitChange { code: string; from: string | null; to: string | null }

/** Limit changes by code. A limit that vanished is `to: null` — NOT "unlimited" and not zero. Which of those it means
 *  is a decision the plan definition has to state, and guessing would either promise a tenant infinity or cut them
 *  off at nothing. */
export function limitChanges(from: VersionRow, to: VersionRow): LimitChange[] {
  const a = from.limits ?? {}; const b = to.limits ?? {};
  const codes = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out: LimitChange[] = [];
  for (const code of codes) {
    const av = norm(a[code]); const bv = norm(b[code]);
    if (av !== bv) out.push({ code, from: av, to: bv });
  }
  return out;
}

export interface VersionDiff {
  previous: VersionRow | null;
  fields: FieldChange[];
  features: FeatureDelta;
  limits: LimitChange[];
  /** True when there is a previous version and NOTHING differs — worth saying, because publishing an identical
   *  version is almost always a mistake the operator wants to know about before they do it. */
  identical: boolean;
}

export function diffAgainstPrevious(current: VersionRow, all: readonly VersionRow[]): VersionDiff {
  const previous = previousVersion(current, all);
  if (!previous) {
    return { previous: null, fields: [], features: { added: [], removed: [], included: [], excluded: [] }, limits: [], identical: false };
  }
  const fields = fieldChanges(previous, current);
  const features = featureDelta(previous, current);
  const limits = limitChanges(previous, current);
  const identical = fields.length === 0 && limits.length === 0
    && features.added.length === 0 && features.removed.length === 0
    && features.included.length === 0 && features.excluded.length === 0;
  return { previous, fields, features, limits, identical };
}

/** True when the diff takes something AWAY from a tenant (a feature switched off or removed, or a limit reduced).
 *  The page warns on this specifically: a price rise is a commercial decision somebody made deliberately, whereas a
 *  quietly-dropped feature is usually an editing accident. */
export function isRegressive(diff: VersionDiff): boolean {
  if (diff.features.excluded.length > 0 || diff.features.removed.length > 0) return true;
  return diff.limits.some((l) => {
    if (l.from === null || l.to === null) return l.to === null;   // a limit that vanished is a regression to explain
    const a = Number(l.from); const b = Number(l.to);
    return Number.isFinite(a) && Number.isFinite(b) && b < a;
  });
}
