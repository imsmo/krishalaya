// apps/web-gov/src/features/gov2/schemes.ts · PC-56 GOV-2b — the scheme pages' PURE pieces (W326–W329). GOV-2 Q1-A and Q5-A (lead-applied
// 2026-11-10; the founder may reopen): the authority READS its schemes as GOV-2a's B3 read gives them (`gov.schemes.{list,get,versions,diff}`
// — published fields only, never a money figure, a draft's content or an operator id). This module picks a page's state, the words for a
// status, and prints a stored value AS STORED (the window, regions, documents, form fields). It computes nothing and converts nothing.
import type { GovScheme, GovSchemeVersion } from '@krishalaya/sdk-js';

export interface ReadError { status: number; code: string }

export type SchemesState = 'ok' | 'empty' | 'off' | 'forbidden' | 'error';
/** The list's state: a read that answered is `ok` (or `empty` when the authority runs no scheme); a refusal by status. */
export function schemesState(list: GovScheme[] | null, err: ReadError | null): SchemesState {
  if (err?.status === 404) return 'off';
  if (err?.status === 403) return 'forbidden';
  if (err || !list) return 'error';
  return list.length === 0 ? 'empty' : 'ok';
}

export type SchemeState = 'ok' | 'not_found' | 'off' | 'forbidden' | 'error';
/** One scheme's state: GOV_SCHEME_NOT_FOUND (an unknown id, a malformed one, or ANOTHER authority's scheme — the same 404) is `not_found`;
 *  any other 404 is the console's switch (gov_console OFF). */
export function schemeState(scheme: GovScheme | null, err: ReadError | null): SchemeState {
  if (err?.status === 404) return err.code === 'GOV_SCHEME_NOT_FOUND' ? 'not_found' : 'off';
  if (err?.status === 403) return 'forbidden';
  if (err || !scheme) return 'error';
  return 'ok';
}

export const activeKey = (s: Pick<GovScheme, 'isActive'>): string => (s.isActive ? 'gov2.active' : 'gov2.inactive');
const VERSION_STATUSES = ['published', 'superseded'];
export const versionStatusKey = (status: string): string => (VERSION_STATUSES.includes(status) ? `gov2.ver.status.${status}` : 'common.dash');
/** "Published by a second person" AS THE READ SAYS: yes; or not recorded (a backfilled version names no publisher); never inferred. */
export const secondPersonKey = (v: Pick<GovSchemeVersion, 'publishedBySecondPerson' | 'isBackfilled'>): string =>
  (v.publishedBySecondPerson ? 'gov2.ver.second.yes' : v.isBackfilled ? 'gov2.ver.second.backfilled' : 'gov2.ver.second.no');

/** The version whose diff the versions tab shows: `?v=N` when N is one of the listed versions, else the newest listed; null when none. */
export function diffVersion(v: string | string[] | undefined, versions: GovSchemeVersion[]): number | null {
  const raw = Array.isArray(v) ? v[0] : v;
  const n = raw && /^[0-9]{1,6}$/.test(raw) ? Number(raw) : NaN;
  if (versions.some((x) => x.version === n)) return n;
  return versions.length ? versions[0].version : null;
}

/** A stored value printed AS STORED: a string as it is; a number or a flag as written; a list item by its name (or label, or key); an object
 *  as "key: value" pairs in its own order. Empty → null (the view prints its own "none" words). Nothing is converted or computed. */
export function asStored(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.length ? v : null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const parts = v.map((x) => itemName(x)).filter((x): x is string => !!x);
    return parts.length ? parts.join('; ') : null;
  }
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>).map(([k, x]) => { const s = asStored(x); return s === null ? null : `${k}: ${s}`; }).filter((x): x is string => !!x);
    return parts.length ? parts.join(' · ') : null;
  }
  return null;
}
function itemName(x: unknown): string | null {
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const o = x as Record<string, unknown>;
    if (typeof o.label === 'string' && typeof o.key === 'string') return `${o.label} (${o.key})`;
    for (const k of ['name', 'label', 'key', 'code']) if (typeof o[k] === 'string' && (o[k] as string).length) return o[k] as string;
  }
  return asStored(x);
}

/** The diff fields the read compares (0240 gov_scheme_version_diff), in its order — each has words in the catalogue. */
export const DIFF_FIELDS: readonly string[] = Object.freeze(['benefitType', 'instalments', 'rules', 'applicationWindow', 'regions', 'requiredDocuments', 'formFields']);
export const diffFieldKey = (f: string): string => (DIFF_FIELDS.includes(f) ? `gov2.ver.field.${f}` : 'common.dash');
