// apps/web-partner/src/features/partner2/figures.ts · PC-56 PARTNER-2a · THE INSURER READS ITS OWN BOOK — the presentational maths and the
// page states. PURE (no React, no fetch). The SERVER computes every figure (`/v1/partner/insurance/*`: counts, bigint minor-unit sums,
// integer basis points, `computedAt`); this file only turns them into text and links, with integer arithmetic — no float ever appears.
//   • the kind of partner (from `/me`'s `organisation.kind`, `financial_partners.partner_kind`) decides where a person lands and which nav
//     group they see: `insurer` → the insurer console; `bank` / `nbfc` / `mfi` / `gold_loan` → the lender console; `amc` → neither vertical
//     (an asset manager neither lends nor insures on the platform — it sees the common and account groups only); unknown (the read failed) →
//     the lender console as before PARTNER-2 (never a guess that opens the insurer pages);
//   • a failed read → `off` (the console is switched off), `insurance_off` (the platform's `insurance` flag is off — the API's named 404) or
//     `error` (anything else) — never an outage sentence for a switch;
//   • a policy number that is NULL (every activated policy today: nobody issues on the platform — founder Q5) prints "no policy number yet",
//     never an invented number.
import { bpsPercentText } from '../partner1/dashboard';
import { navKind, type NavKind } from '../nav/nav-model';

/** ONE rule for the kind (features/nav/nav-model.ts `navKind`): insurer / lender (bank, nbfc, mfi, gold_loan) / other (amc) / unknown. */
export type PartnerKindClass = NavKind;
export const partnerKindClass = (kind: string | null | undefined): PartnerKindClass => navKind(kind);
/** Where a partner person lands: an insurer on the insurer dashboard, everyone else on the (lender) dashboard. */
export function homeFor(kind: string | null | undefined): '/insurer/dashboard' | '/dashboard' {
  return partnerKindClass(kind) === 'insurer' ? '/insurer/dashboard' : '/dashboard';
}
/** A lender (or an asset manager) who opens an insurer page is sent to its own dashboard; an insurer who opens `/dashboard` to the insurer's. */
export function wrongConsole(kind: string | null | undefined, page: 'insurer' | 'lender'): boolean {
  const c = partnerKindClass(kind);
  return page === 'insurer' ? c === 'lender' || c === 'other' : c === 'insurer';
}

export type InsurerFailure = 'off' | 'insurance_off' | 'error';
/** A failed read → its state: the API's named 404 for the platform's `insurance` flag; a 404 while the flag map says the console is OFF;
 *  anything else is the error state. */
export function insurerFailureOf(status: number | undefined, code: string | undefined, consoleSwitch: 'on' | 'off' | 'unknown'): InsurerFailure {
  if (status === 404 && code === 'PARTNER_INSURANCE_SWITCHED_OFF') return 'insurance_off';
  if (status === 404 && consoleSwitch === 'off') return 'off';
  return 'error';
}

export type InsurerDashboardState = 'ok' | 'empty' | InsurerFailure;
export function insurerDashboardState(d: { policies: number; products: number } | null, failure: InsurerFailure | null): InsurerDashboardState {
  if (failure) return failure;
  if (!d) return 'error';
  return d.policies === 0 && d.products === 0 ? 'empty' : 'ok';
}
export type InsurerListState = 'ok' | 'empty' | InsurerFailure;
export function listState(items: readonly unknown[] | null, failure: InsurerFailure | null): InsurerListState {
  if (failure) return failure;
  if (!items) return 'error';
  return items.length === 0 ? 'empty' : 'ok';
}

/** The policy's number, or the honest sentence — never an invented number. */
export function policyNoText(policyNo: string | null | undefined, none: string): string {
  return policyNo && policyNo.trim() ? policyNo : none;
}
/** The short reference of a policy (its uuid's head) — the link carries the full id. */
export const policyRef = (id: string) => `${id.slice(0, 8)}…`;

export const POLICY_STATUSES = ['proposed', 'active', 'lapsed', 'cancelled', 'expired', 'claimed'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];
export const isPolicyStatus = (v: unknown): v is PolicyStatus => typeof v === 'string' && (POLICY_STATUSES as readonly string[]).includes(v);
export const statusKey = (s: string) => (isPolicyStatus(s) ? `partner2.status.${s}` : 'partner2.status.unknown');
export function statusTone(s: string): 'ok' | 'info' | 'muted' | 'warn' {
  if (s === 'active') return 'ok';
  if (s === 'proposed') return 'info';
  if (s === 'claimed') return 'warn';
  return 'muted';
}
export const SUBJECT_TYPES = ['crop_season', 'animal', 'equipment', 'person', 'shipment'] as const;
export const subjectKey = (s: string) => ((SUBJECT_TYPES as readonly string[]).includes(s) ? `partner2.subject.${s}` : 'partner2.subject.other');

/** The policies list's own links: the status filter and the keyset page — nothing else ever enters the URL. */
export function policiesHref(status?: string, cursor?: string): string {
  const q = new URLSearchParams();
  if (status && isPolicyStatus(status)) q.set('status', status);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `/insurer/policies?${s}` : '/insurer/policies';
}
/** The list's query from the URL: a status of the machine, a cursor (opaque, ≤ 200 characters), never anything else. */
export function policiesQuery(sp: Record<string, string | string[] | undefined> | undefined): { status?: PolicyStatus; cursor?: string } {
  const one = (k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };
  const status = one('status'); const cursor = one('cursor');
  return { status: isPolicyStatus(status) ? status : undefined, cursor: cursor && cursor.length <= 200 && /^[A-Za-z0-9_-]+$/.test(cursor) ? cursor : undefined };
}

export type Formula = { kind: 'pct_of_sum_insured'; bps: number } | { kind: 'flat_minor'; amountMinor: string } | { kind: 'not_priceable' };
/** The insurer's own pricing terms as a sentence key + its variables (the rate from INTEGER bps — "3.2" from 320; never a float). */
export function formulaText(f: Formula | null | undefined): { key: string; vars: Record<string, string> } {
  if (f && f.kind === 'pct_of_sum_insured') return { key: 'partner2.formula.pct', vars: { rate: bpsPercentText(f.bps) ?? '0.0', bps: String(f.bps) } };
  if (f && f.kind === 'flat_minor') return { key: 'partner2.formula.flat', vars: { amountMinor: f.amountMinor } };
  return { key: 'partner2.formula.notPriceable', vars: {} };
}
/** Integer basis points as one-decimal percent text ("40.0" from 4000). */
export function bpsText(bps: number): string { return bpsPercentText(bps) ?? '0.0'; }

/** The policies on one product, all statuses added (integers from the server). */
export function policiesTotal(byStatus: Record<string, number> | null | undefined): number {
  return Object.values(byStatus ?? {}).reduce((a, n) => a + (Number.isInteger(n) ? n : 0), 0);
}

/** An FPO's PUBLIC display name, or the neutral word (the API answered null for a non-live organisation). */
export function fpoLabel(name: string | null | undefined, neutral: string): string { return name && name.trim() ? name : neutral; }

/** Stored jsonb terms as display text (stable key order is the server's; nothing is evaluated). */
export function termsText(v: unknown): string {
  if (v === null || v === undefined) return '';
  try { return JSON.stringify(v, null, 2); } catch { return ''; }
}
