// apps/web-partner/src/features/partner3/figures.ts · PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS — the presentational maths and the
// page states. PURE (no React, no fetch). The SERVER computes every figure (`/v1/partner/insurance/claims*`: claim facts, integer counts, the
// waiting days against `computedAt`, the FY window answered by the database); this file only turns them into text and links.
//   • the queue row model: the claim REFERENCE (the id's short form — there is no claim number), waiting days, the event type CODE's label or
//     "not recorded", the subject TYPE, the policy's sum insured, "reported within 72 hours: yes / no" as RECORDED (a late report is recorded;
//     nothing rejects a claim for it), the status word from the real state machine;
//   • the damage percentage: a whole number 0–100 printed with "%" — the ONE percentage any 3a page may print, because it is a figure the
//     survey RECORDED (`damageText`); every other figure on these pages is an integer count or a minor-unit amount, never a ratio or a rate;
//   • the counts: the queue's chips (by status, the approved chip = approved + partially approved, paid or closed together) and the insights
//     page's rows (by status, by the eight platform event codes + not recorded, the decided counts) — integers only;
//   • the FY label from the window the server answered ("FY 2026-27"), never from the browser's clock.
import { listState, type InsurerFailure, type InsurerListState } from '../partner2/figures';

export { listState };
export type { InsurerFailure, InsurerListState };

/** The claim state machine's own statuses (apps/api insurance-claim.state.ts — never invented). */
export const CLAIM_STATUSES = ['intimated', 'docs_pending', 'survey_scheduled', 'surveyed', 'approved', 'partially_approved', 'rejected', 'paid', 'closed'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const isClaimStatus = (v: unknown): v is ClaimStatus => typeof v === 'string' && (CLAIM_STATUSES as readonly string[]).includes(v);
export const claimStatusKey = (s: string) => (isClaimStatus(s) ? `partner3.status.${s}` : 'partner3.status.unknown');
export function claimStatusTone(s: string): 'ok' | 'info' | 'muted' | 'warn' {
  if (s === 'approved' || s === 'partially_approved') return 'ok';
  if (s === 'rejected') return 'warn';
  if (s === 'paid' || s === 'closed') return 'muted';
  return 'info';
}

/** The platform's `claim_event` vocabulary (seed 0005: eight codes). A code outside it prints as itself; none prints "not recorded". */
export const CLAIM_EVENT_CODES = ['drought', 'flood', 'hail', 'pest', 'death', 'theft', 'fire', 'accident'] as const;
export const NOT_RECORDED = 'not_recorded';
export function eventLabel(code: string | null | undefined): { key: string } | { raw: string } {
  if (!code || code === NOT_RECORDED) return { key: 'partner3.event.notRecorded' };
  return (CLAIM_EVENT_CODES as readonly string[]).includes(code) ? { key: `partner3.event.${code}` } : { raw: code };
}

/** The claim's REFERENCE: its id's head (the link carries the full id). There is no claim number on the platform. */
export const claimRef = (id: string) => `${id.slice(0, 8)}…`;

/** "Reported within 72 hours" as RECORDED at filing — yes, no, or not recorded. Never an hour count (none is stored). */
export function reportedKey(v: boolean | null | undefined): 'partner3.claims.reportedYes' | 'partner3.claims.reportedNo' | 'partner3.claims.reportedUnknown' {
  return v === true ? 'partner3.claims.reportedYes' : v === false ? 'partner3.claims.reportedNo' : 'partner3.claims.reportedUnknown';
}

/** The survey's damage percentage — the ONLY "%" a 3a page prints, and only for a whole number 0–100 the survey recorded. */
export function damageText(v: number | null | undefined): string | null {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100 ? `${v}%` : null;
}

/** Waiting days (the server's integer) as a sentence key + its variable; null once the claim is rejected, paid or closed. */
export function waitingText(days: number | null | undefined): { key: 'partner3.claims.waitingDays' | 'partner3.claims.waitingToday'; vars: { days: string } } | null {
  if (!Number.isInteger(days) || (days as number) < 0) return null;
  return days === 0 ? { key: 'partner3.claims.waitingToday', vars: { days: '0' } } : { key: 'partner3.claims.waitingDays', vars: { days: String(days) } };
}

/** The queue's own links: the status filter and the keyset page — nothing else ever enters the URL. */
export function claimsHref(status?: string, cursor?: string): string {
  const q = new URLSearchParams();
  if (status && isClaimStatus(status)) q.set('status', status);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `/insurer/claims?${s}` : '/insurer/claims';
}
/** The queue's query from the URL: a status of the machine, an opaque cursor (≤ 200 URL-safe characters), never anything else. */
export function claimsQuery(sp: Record<string, string | string[] | undefined> | undefined): { status?: ClaimStatus; cursor?: string } {
  const one = (k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };
  const status = one('status'); const cursor = one('cursor');
  return { status: isClaimStatus(status) ? status : undefined, cursor: cursor && cursor.length <= 200 && /^[A-Za-z0-9_-]+$/.test(cursor) ? cursor : undefined };
}

/** The queue's count chips (founder Q4, survey §1A): seven COUNTS of the claims filed in the window. The canon's "approved · paying" is the
 *  approved chip — approved + partially approved — and the word "paying" is refused (nothing pays a claim on the platform). */
export const CLAIM_CHIPS: readonly { id: string; key: string; statuses: readonly ClaimStatus[] }[] = Object.freeze([
  { id: 'intimated', key: 'partner3.chip.intimated', statuses: ['intimated'] },
  { id: 'docs_pending', key: 'partner3.chip.docsPending', statuses: ['docs_pending'] },
  { id: 'survey_scheduled', key: 'partner3.chip.surveyScheduled', statuses: ['survey_scheduled'] },
  { id: 'surveyed', key: 'partner3.chip.surveyed', statuses: ['surveyed'] },
  { id: 'approved', key: 'partner3.chip.approved', statuses: ['approved', 'partially_approved'] },
  { id: 'rejected', key: 'partner3.chip.rejected', statuses: ['rejected'] },
  { id: 'paid_closed', key: 'partner3.chip.paidClosed', statuses: ['paid', 'closed'] },
]);
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
export function chipCounts(byStatus: Record<string, number> | null | undefined): Array<{ id: string; key: string; n: number }> {
  return CLAIM_CHIPS.map((c) => ({ id: c.id, key: c.key, n: c.statuses.reduce((a, s) => a + int(byStatus?.[s]), 0) }));
}

/** The insights rows: every status of the machine; the eight platform event codes in their registry order, any other code the server
 *  answered, and "not recorded" last; the decided counts. Integers only. */
export function statusRows(byStatus: Record<string, number> | null | undefined): Array<{ status: ClaimStatus; key: string; n: number }> {
  return CLAIM_STATUSES.map((s) => ({ status: s, key: claimStatusKey(s), n: int(byStatus?.[s]) }));
}
export function eventRows(byEvent: Record<string, number> | null | undefined): Array<{ code: string; label: { key: string } | { raw: string }; n: number }> {
  const extra = Object.keys(byEvent ?? {}).filter((k) => k !== NOT_RECORDED && !(CLAIM_EVENT_CODES as readonly string[]).includes(k) && /^[a-z][a-z_]{0,59}$/.test(k)).sort();
  return [...CLAIM_EVENT_CODES, ...extra, NOT_RECORDED].map((code) => ({ code, label: eventLabel(code), n: int(byEvent?.[code]) }));
}
export function decidedRows(d: { approved: number; partiallyApproved: number; rejected: number } | null | undefined): Array<{ id: string; key: string; n: number }> {
  return [
    { id: 'approved', key: 'partner3.insights.decidedApproved', n: int(d?.approved) },
    { id: 'partially_approved', key: 'partner3.insights.decidedPartial', n: int(d?.partiallyApproved) },
    { id: 'rejected', key: 'partner3.insights.decidedRejected', n: int(d?.rejected) },
  ];
}

/** The window's label: "FY 2026-27" when the server answered an FY, else the two days — never computed from the browser's clock. */
export function windowLabel(w: { from: string; to: string; fy: string | null } | null | undefined): { key: 'partner3.insights.fy' | 'partner3.insights.window'; vars: Record<string, string> } | null {
  if (!w) return null;
  return w.fy ? { key: 'partner3.insights.fy', vars: { fy: w.fy } } : { key: 'partner3.insights.window', vars: { from: w.from, to: w.to } };
}

/** A page whose read is the counts: ok / empty (no claim filed in the window) / its failure. */
export type CountsState = 'ok' | 'empty' | InsurerFailure;
export function countsState(c: { total: number } | null, failure: InsurerFailure | null): CountsState {
  if (failure) return failure;
  if (!c) return 'error';
  return c.total === 0 ? 'empty' : 'ok';
}
