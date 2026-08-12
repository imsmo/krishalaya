// apps/admin-api/src/modules/farmer360/domain/farmer360.ts · W109 pure rules (PC-56 ADMIN-SWEEP-b4). No I/O.
//
// TWO DISCIPLINES RUN THROUGH THIS FILE, both inherited from the tenant twin (W155, read-models/farmer-360):
//   • UNKNOWN ≠ ZERO. A farmer with no dairy membership has dairy income NULL, not '0' — zero says "we looked and
//     there was none"; null says "there is nothing to look at". Totals that include a null stay null.
//   • MASKED AT THE ONE SHAPING POINT. Identity leaves through identityView() only, so no new call site can skip
//     the masking — and the EXPORT uses the same masked shape (piiMasked: true on the receipt is a fact, not a flag).
import { maskName, maskPhone } from '../../../core/pii/mask';

/** Orders that COUNT as realized sales for lifetime GMV (0005's enum; 'delivered' and 'completed' are the two
 *  states money has actually moved for). */
export const GMV_ORDER_STATUSES = ['delivered', 'completed'] as const;

/** Reason floor for the audited export — same bar the PII reveal uses (a reason someone can act on later). */
export const EXPORT_REASON_MIN = 10;

export class Farmer360RuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function assertExportReason(reason: unknown): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < EXPORT_REASON_MIN) {
    throw new Farmer360RuleError('F360_REASON_REQUIRED',
      `Exporting one person's whole profile lands in the audit trail WITH ITS REASON (W109) — write at least ${EXPORT_REASON_MIN} characters someone can act on later.`);
  }
  return r;
}

/* ------------------------------------------------------------------ identity */

export function identityView(v: { userId: string; fullName: string | null; phone: string | null; languageCode: string | null; createdAt: string; tenants: string[] }) {
  return {
    userId: v.userId,
    name: maskName(v.fullName),
    phone: maskPhone(v.phone),
    languageCode: v.languageCode,
    memberSince: v.createdAt,
    tenants: v.tenants,
  };
}

/* ------------------------------------------------------------------ tiles (unknown ≠ zero) */

/** A money tile: value is a MINOR-UNIT STRING or null. `basis` says what the figure is computed over, because a
 *  number without its basis is how "18% overturn rate" outlives its caveat. */
export interface MoneyTile { valueMinor: string | null; basis: string; n: number }

export function moneyTile(valueMinor: bigint | null, basis: string, n: number): MoneyTile {
  return { valueMinor: valueMinor === null ? null : valueMinor.toString(), basis, n };
}

/** Listed value = Σ price × qty over PUBLISHED listings — same exact bigint arithmetic the moderation queue uses
 *  (three decimals, half-up), so the two consoles cannot disagree about one farmer's stock. */
export function listedValueMinor(rows: readonly { priceMinor: string; quantityAvailable: string }[]): bigint | null {
  if (rows.length === 0) return null;
  let total = 0n;
  for (const r of rows) {
    const [ip, fp = ''] = r.quantityAvailable.split('.');
    if (!/^\d+$/.test(ip) || !/^\d{0,3}$/.test(fp)) {
      throw new Farmer360RuleError('F360_BAD_QUANTITY', `unreadable listing quantity '${r.quantityAvailable}' — refusing to guess a farmer's stock value`);
    }
    const milli = BigInt(ip) * 1000n + BigInt(fp.padEnd(3, '0'));
    const num = BigInt(r.priceMinor) * milli;
    total += (num + 500n) / 1000n;   // half-up, never understating
  }
  return total;
}

/* ------------------------------------------------------------------ engagement (only what is real) */

/** Active days out of the last 30, from login_events — the one per-user activity register that exists. The canon's
 *  "voice search 71% of sessions" and "Senior Farmer Mode" have NO per-user source anywhere; they are refused, not
 *  invented, and the panel names what it is computed from. */
export function engagementView(v: { activeDays30: number; lastActiveAt: string | null; languageCode: string | null }) {
  return {
    activeDays30: Math.min(30, Math.max(0, v.activeDays30)),
    lastActiveAt: v.lastActiveAt,
    languageCode: v.languageCode,
    basis: 'distinct successful-login days in the last 30 (login_events) — no per-session feature usage exists on this platform',
  };
}

/** The dispute record, both directions, resolved outcomes only counted as history. */
export function disputeView(v: { raised: number; against: number; resolved: number; open: number }) {
  return { ...v };
}

/* ------------------------------------------------------------------ timeline */

export interface TimelineItem { kind: 'order' | 'listing' | 'benefit'; at: string; label: string; amountMinor: string | null; ref: string }

/** Merge the three real registers, newest first, bounded. Every item names its register — a timeline that mixes
 *  sources without saying so is how a benefit credit reads as a sale. */
export function mergeTimeline(items: TimelineItem[], limit: number): TimelineItem[] {
  return [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/* ------------------------------------------------------------------ export shape */

/** The export is the MASKED profile, flattened to columns+rows for the 0120 receipt/digest machinery. One row per
 *  section figure — a person's profile is not a series, and pretending it is one would invent time buckets. */
export function exportRows(p: {
  identity: ReturnType<typeof identityView>;
  gmv: MoneyTile; listed: MoneyTile; dairy30d: MoneyTile; schemesYtd: MoneyTile; wallet: MoneyTile;
  risk: { score: number; band: string } | null;
  engagement: ReturnType<typeof engagementView>;
  disputes: ReturnType<typeof disputeView>;
}): { columns: string[]; rows: (string | number | null)[][] } {
  const columns = ['section', 'field', 'value', 'basis'];
  const rows: (string | number | null)[][] = [
    ['identity', 'user_id', p.identity.userId, ''],
    ['identity', 'name_masked', p.identity.name, 'masked at source; unmasking is a different, recorded act'],
    ['identity', 'phone_masked', p.identity.phone, ''],
    ['identity', 'language', p.identity.languageCode, ''],
    ['identity', 'tenants', p.identity.tenants.join(' · '), ''],
    ['money', 'lifetime_gmv_minor', p.gmv.valueMinor, p.gmv.basis],
    ['money', 'listed_value_minor', p.listed.valueMinor, p.listed.basis],
    ['money', 'dairy_income_30d_minor', p.dairy30d.valueMinor, p.dairy30d.basis],
    ['money', 'scheme_benefits_ytd_minor', p.schemesYtd.valueMinor, p.schemesYtd.basis],
    ['money', 'wallet_balance_minor', p.wallet.valueMinor, p.wallet.basis],
    ['trust', 'risk_score', p.risk ? p.risk.score : null, p.risk ? p.risk.band : 'no scored event exists'],
    ['engagement', 'active_days_30', p.engagement.activeDays30, p.engagement.basis],
    ['disputes', 'raised/against/resolved/open',
      `${p.disputes.raised}/${p.disputes.against}/${p.disputes.resolved}/${p.disputes.open}`, ''],
  ];
  return { columns, rows };
}
