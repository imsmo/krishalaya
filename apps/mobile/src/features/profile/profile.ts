// apps/mobile/src/features/profile/profile.ts · PURE logic for the farmer profile/farm/bank/docs + help vertical
// (P-22). No React/native (SDK/ui types are `import type` → erased) → unit-tested. The SERVER owns profile writes,
// the support SLA clock + ticket state machine, KYC verification, and bank vaulting — these helpers only drive the
// UI: profile-patch + ticket + parcel form validation (bounded, ReDoS-safe), status/severity tone+labels, the SLA
// state read-out (server-set due-times vs now), and masked bank/area display.
import type { PillTone } from '@krishalaya/ui-native';
import type { SupportTicket, TicketSeverity, TicketStatus, LandParcel, BankAccount, KycDocument } from '@krishalaya/sdk-js';

/** Whether the caller has at least one VERIFIED KYC document (screen 132 hero "verified" badge). The server owns
 * verification; this only reads the real doc list. Pure — never asserts a specific doc type (GST/FSSAI aren't
 * distinguishable from the KycDocument contract, §13). */
export function hasVerifiedKyc(docs: ReadonlyArray<Pick<KycDocument, 'status'>> | null | undefined): boolean {
  return !!docs && docs.some((d) => d.status === 'verified');
}

// --- profile edit ---
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/; // bounded, no catastrophic backtracking
export function isValidEmail(email: string): boolean { return EMAIL_RE.test(email.trim()); }

export interface ProfileForm { fullName?: string; languageCode?: string; email?: string }
export interface ProfilePatch { fullName?: string; languageCode?: string; email?: string; gender?: 'male' | 'female' | 'other' | 'undisclosed' }
export interface ProfileDraft { ok: boolean; patch?: ProfilePatch; reason?: 'empty' | 'name' | 'email' }
/** Assemble a PATCH /users/me payload from the form. Drops blanks (only changed fields sent); validates email +
 * a non-empty trimmed name. Returns `empty` if nothing to change. The server re-validates (zod .strict). */
export function buildProfilePatch(form: ProfileForm): ProfileDraft {
  const patch: ProfilePatch = {};
  const name = (form.fullName ?? '').trim();
  if (name) { if (name.length > 200) return { ok: false, reason: 'name' }; patch.fullName = name; }
  const lang = (form.languageCode ?? '').trim();
  if (lang) patch.languageCode = lang;
  const email = (form.email ?? '').trim();
  if (email) { if (!isValidEmail(email)) return { ok: false, reason: 'email' }; patch.email = email; }
  if (Object.keys(patch).length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, patch };
}

// --- support tickets ---
export const TICKET_SEVERITIES: TicketSeverity[] = ['P0', 'P1', 'P2', 'P3'];
export function ticketStatusTone(status: TicketStatus | string): PillTone {
  switch (status) {
    case 'resolved': case 'closed': return 'success';
    case 'escalated': return 'danger';
    case 'pending_customer': case 'pending_internal': return 'warning';
    case 'open': case 'reopened': return 'info';
    default: return 'neutral';
  }
}
export function severityTone(sev: TicketSeverity | string): PillTone {
  switch (sev) { case 'P0': return 'danger'; case 'P1': return 'warning'; case 'P2': return 'info'; default: return 'neutral'; }
}
/** CSAT is only meaningful once the ticket is resolved/closed. */
export function canRateCsat(status: TicketStatus | string): boolean { return status === 'resolved' || status === 'closed'; }

export type SlaState = 'met' | 'due' | 'breached' | 'none';
/** Resolution-SLA read-out (UX only; the server is the authority on the clock): met if resolved before due,
 * breached if past due + unresolved, due if pending and within window. `now` injectable for tests. */
export function resolutionSlaState(t: Pick<SupportTicket, 'slaResolutionDue' | 'resolvedAt'>, now: number = Date.now()): SlaState {
  const due = t.slaResolutionDue ? Date.parse(t.slaResolutionDue) : NaN;
  const resolved = t.resolvedAt ? Date.parse(t.resolvedAt) : NaN;
  if (!Number.isNaN(resolved)) return Number.isNaN(due) || resolved <= due ? 'met' : 'breached';
  if (Number.isNaN(due)) return 'none';
  return now > due ? 'breached' : 'due';
}

// --- report-a-problem (screen 124): app-defined issue types → severity, and a single subject line assembled from
// the issue + optional order ref + description (the ticket contract has only subject/categoryId/severity — no body
// field — so we fold everything into the subject; the server re-validates + sets the SLA from severity). ---
export const REPORT_ISSUES = [
  { key: 'payment', severity: 'P1' }, { key: 'pickup', severity: 'P1' }, { key: 'quality', severity: 'P2' },
  { key: 'rejected', severity: 'P2' }, { key: 'fraud', severity: 'P0' }, { key: 'app', severity: 'P3' },
] as const;
export type ReportIssueKey = (typeof REPORT_ISSUES)[number]['key'];
/** The default severity for an issue type (the farmer can still override). Unknown → P2. Pure. */
export function reportIssueSeverity(key: string | null | undefined): TicketSeverity {
  return (REPORT_ISSUES.find((i) => i.key === key)?.severity ?? 'P2') as TicketSeverity;
}
/** Assemble the one-line ticket subject from the chosen issue label + optional order ref + free-text description.
 * Trimmed; the caller (buildTicketDraft) caps it to 250. Pure — no I/O. */
export function composeReportSubject(parts: { issueLabel?: string; orderRef?: string; description?: string }): string {
  const issue = (parts.issueLabel ?? '').trim();
  const order = (parts.orderRef ?? '').trim();
  const desc = (parts.description ?? '').trim();
  const head = [issue, order ? `[${order}]` : ''].filter(Boolean).join(' ');
  return [head, desc].filter(Boolean).join(head && desc ? ': ' : '').trim();
}

export interface TicketForm { subject?: string; categoryId?: string | null; severity?: string }
export interface TicketInput { subject?: string; categoryId?: string; severity: TicketSeverity }
export interface TicketDraft { ok: boolean; input?: TicketInput; reason?: 'empty' | 'severity' }
/** Validate + assemble an open-ticket payload. Needs a subject (or a category); severity defaults to P2. */
export function buildTicketDraft(form: TicketForm): TicketDraft {
  const subject = (form.subject ?? '').trim().slice(0, 250);
  const categoryId = form.categoryId ?? undefined;
  if (!subject && !categoryId) return { ok: false, reason: 'empty' };
  const severity = (form.severity ?? 'P2') as TicketSeverity;
  if (!TICKET_SEVERITIES.includes(severity)) return { ok: false, reason: 'severity' };
  return { ok: true, input: { subject: subject || undefined, categoryId, severity } };
}

// --- land parcels ---
const AREA_RE = /^\d{1,6}(\.\d{1,4})?$/;
export function parcelAreaLabel(p: Pick<LandParcel, 'area' | 'areaUnit'>): string { return `${p.area} ${p.areaUnit}`; }

/** Avatar initials from a display name (screen 61). Up to 2 letters: first + last word. Empty → '?'. Pure. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** A land-holding summary across the farmer's parcels (screen 61): total area in the predominant unit + ownership.
 * Areas are decimal STRINGS in possibly-mixed units → we sum within the FIRST unit only and tag the rest as mixed.
 * Returns null when there are no parcels (caller degrades). Pure — no money. */
export function landHoldingLabel(parcels: Array<Pick<LandParcel, 'area' | 'areaUnit' | 'isTenantFarmed'>>): { area: string; unit: string; mixedUnits: boolean; ownership: 'owned' | 'tenant' | 'mixed' } | null {
  const list = (parcels ?? []).filter((p) => p && p.area != null);
  if (!list.length) return null;
  const unit = list[0].areaUnit;
  const mixedUnits = list.some((p) => p.areaUnit !== unit);
  let sum = 0;
  for (const p of list) { if (p.areaUnit === unit) { const n = Number(p.area); if (Number.isFinite(n)) sum += n; } }
  const anyTenant = list.some((p) => p.isTenantFarmed);
  const anyOwned = list.some((p) => !p.isTenantFarmed);
  const ownership = anyTenant && anyOwned ? 'mixed' : anyTenant ? 'tenant' : 'owned';
  // trim trailing zeros from the summed decimal
  const area = Number.isInteger(sum) ? String(sum) : String(parseFloat(sum.toFixed(4)));
  return { area, unit, mixedUnits, ownership };
}
export function parcelStatusTone(status: string): PillTone {
  switch (status) { case 'verified': return 'success'; case 'rejected': return 'danger'; case 'pending': return 'warning'; default: return 'neutral'; }
}
export interface ParcelForm { areaValue?: string; areaUnit?: string; surveyNo?: string; regionId?: string }
export interface ParcelInput { areaValue: string; areaUnit: string; surveyNo?: string; regionId?: string }
export interface ParcelDraft { ok: boolean; input?: ParcelInput; reason?: 'area' }
/** Validate + assemble a register-parcel payload. `areaValue` is a positive decimal (≤4 dp), NOT money. */
export function buildParcelDraft(form: ParcelForm): ParcelDraft {
  const areaValue = (form.areaValue ?? '').trim();
  if (!AREA_RE.test(areaValue) || Number(areaValue) <= 0) return { ok: false, reason: 'area' };
  return { ok: true, input: { areaValue, areaUnit: (form.areaUnit || 'acre').trim(), surveyNo: (form.surveyNo ?? '').trim() || undefined, regionId: form.regionId } };
}

// --- bank accounts (display only; never the raw number) ---
/** The bank's 4-letter code from an IFSC (the first 4 chars ARE the bank code — deterministic, real; not a brand
 * NAME, which the contract doesn't carry). e.g. 'SBIN0001247' → 'SBIN'. Null when the IFSC is malformed. Pure. */
export function bankCodeFromIfsc(ifsc: string | null | undefined): string | null {
  const s = (ifsc ?? '').trim().toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s) ? s.slice(0, 4) : null;
}

/** A masked, human label for a saved payout destination — last-4/IFSC for a bank, the VPA for UPI. */
export function bankLabel(a: Pick<BankAccount, 'accountKind' | 'upiId' | 'accountLast4' | 'ifsc'>): string {
  if (a.accountKind === 'upi') return a.upiId ?? 'UPI';
  const last4 = a.accountLast4 ? `••••${a.accountLast4}` : '••••';
  return a.ifsc ? `${last4} · ${a.ifsc}` : last4;
}
/** UPI VPA validation (a VPA is a public payment address, not a secret): name@handle, bounded. */
const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
export function isValidVpa(vpa: string): boolean { return VPA_RE.test((vpa ?? '').trim()); }
