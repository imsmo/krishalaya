// modules/logistics/domain/logistics-ops.ts · PC-56 TENANT-SW-e — the PURE rules of logistics ops: carriers' figures, the pickup
// desk's proposals and suggestions, the Village Run's numbers, the device-ingest signature, and the cold-chain breach acts.
//
// THE HONESTY RULE (F-27). Every figure the console prints is either READ with a method (the method travels with it) or REFUSED
// BY NAME (a code the console turns into a sentence). Nothing here computes a number the platform has no fact for. The refusals
// are listed once (`REFUSED_BY_NAME`) so the API, the console and the export all say the same thing.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/* ──────────────────────────────────────────── refusals ──────────────────────────────────────────── */
export const REFUSED_BY_NAME = {
  /** W228 "On-time": shipments carry no promised / expected delivery time — only a scheduled PICKUP — so lateness has no reference. */
  onTime: 'NO_PROMISED_DELIVERY_TIME',
  /** W228 "insured through the platform": no insurance record exists for riders (11b class). */
  riderInsured: 'NO_RIDER_INSURANCE_RECORD',
  /** W230 "First-attempt success" of a PICKUP: only DELIVERY attempts are recorded (shipments.delivery_attempts). */
  pickupFirstAttempt: 'NO_PICKUP_ATTEMPT_RECORD',
  /** W230 "Members set slots by voice": no voice capture of slots exists. */
  voiceSlots: 'NO_VOICE_SLOT_CAPTURE',
  /** W232 "Freight per parcel ₹31 vs ₹96 ad-hoc": no ad-hoc freight fact exists to compare with. */
  freightVsAdHoc: 'NO_AD_HOC_FREIGHT_FACT',
  /** W232 "Out (returns/samples)": a run records no return leg. */
  returnLeg: 'NO_RETURN_LEG_RECORD',
  /** W234 "15-min silence auto-calls the responsible operator": no voice channel — the operator is ALERTED, not called. */
  autoCall: 'NO_VOICE_CHANNEL',
  /** W239 "both tenants alerted": a shipment belongs to ONE organisation; no cross-tenant shipment exists on this platform. */
  bothTenants: 'NO_CROSS_TENANT_SHIPMENT',
  /** W239/W240 "playbook run": no playbook object exists; the operator's recorded action is the record. */
  playbookRun: 'NO_PLAYBOOK_OBJECT',
  /** W234/W2534 "Export trail (signed)": signing is a founder-physical key — the file is unsigned; its sha256 is printed. */
  signedExport: 'UNSIGNED_FOUNDER_PHYSICAL_KEY',
} as const;
export type RefusalCode = (typeof REFUSED_BY_NAME)[keyof typeof REFUSED_BY_NAME];

export const UNSIGNED_EXPORT_NOTE = 'unsigned — signing is a founder-physical key; the sha256 is printed';

/* ──────────────────────────────────────────── shared numbers ──────────────────────────────────────────── */
/** A ratio of two counts, in basis points (rounded DOWN), or null when there is nothing to divide by. Integers only. */
export function ratioBps(numerator: number, denominator: number): { numerator: number; denominator: number; bps: number } | null {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0 || numerator < 0) return null;
  return { numerator, denominator, bps: Math.floor((numerator * 10_000) / denominator) };
}

/** The median of whole seconds — the middle value, or the floor of the mean of the two middle values. Null on none. */
export function medianSeconds(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).map((x) => Math.floor(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m] : Math.floor((v[m - 1] + v[m]) / 2);
}

/** The India calendar day of an instant, and its weekday (0 = Sunday). */
export function istDay(d: Date): { ymd: string; weekday: number; minutes: number } {
  const t = new Date(d.getTime() + 330 * 60_000);
  return { ymd: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/* ──────────────────────────────────────────── W228 · carriers ──────────────────────────────────────────── */
export const CARRIER_STATUS_REASON_MIN = 10;
/** "Shipments 30d" is a real count; "On-time" is refused by name — there is no promised delivery time to be late against. */
export function onTimeVerdict(): { kind: 'refused'; code: RefusalCode } { return { kind: 'refused', code: REFUSED_BY_NAME.onTime }; }

export type RiderKyc = 'none' | 'pending' | 'verified' | 'rejected' | 'expired' | 'no_role';
/** W228's rider sentence, judged per fact: KYC from the delivery-partner role (9a), wage terms from rider_payout_terms, insurance refused. */
export function riderFacts(i: { kyc: RiderKyc; riderTerms: boolean; defaultTerms: boolean }) {
  return {
    kycVerified: i.kyc === 'verified', kyc: i.kyc,
    wageProtected: i.riderTerms || i.defaultTerms, wageTerms: i.riderTerms ? 'rider' as const : i.defaultTerms ? 'tenant_default' as const : 'none' as const,
    insured: { kind: 'refused' as const, code: REFUSED_BY_NAME.riderInsured },
  };
}

/* ──────────────────────────────────────────── W230 · pickup slots ──────────────────────────────────────────── */
export interface SlotWindow { weekday: number; start: string; end: string }
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Mirrors 0201's kv_slot_windows_valid: 1–14 windows, each {weekday 0–6, start HH:MM < end HH:MM}, none repeated. */
export function slotWindowsRefusal(w: unknown): 'SLOT_WINDOWS_EMPTY' | 'SLOT_WINDOWS_TOO_MANY' | 'SLOT_WINDOWS_INVALID' | 'SLOT_WINDOWS_DUPLICATE' | null {
  if (!Array.isArray(w) || w.length === 0) return 'SLOT_WINDOWS_EMPTY';
  if (w.length > 14) return 'SLOT_WINDOWS_TOO_MANY';
  const seen = new Set<string>();
  for (const x of w) {
    const s = x as Partial<SlotWindow>;
    if (!s || typeof s !== 'object' || !Number.isInteger(s.weekday) || (s.weekday as number) < 0 || (s.weekday as number) > 6) return 'SLOT_WINDOWS_INVALID';
    if (typeof s.start !== 'string' || typeof s.end !== 'string' || !HHMM.test(s.start) || !HHMM.test(s.end) || s.start >= s.end) return 'SLOT_WINDOWS_INVALID';
    const k = `${s.weekday}|${s.start}|${s.end}`;
    if (seen.has(k)) return 'SLOT_WINDOWS_DUPLICATE';
    seen.add(k);
  }
  return null;
}
export const SLOT_PROPOSAL_DAYS = 7;
export const SLOT_PROPOSAL_STATUSES = ['proposed', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type SlotProposalStatus = (typeof SLOT_PROPOSAL_STATUSES)[number];
export const SLOT_DECISIONS = ['accept', 'decline'] as const;
export type SlotDecision = (typeof SLOT_DECISIONS)[number];

/** The suggestion grid: IST weekday × a three-hour block of the day (06–21). A block a pickup falls outside of is not counted. */
export const SUGGESTION_BLOCKS: ReadonlyArray<{ start: string; end: string; from: number; to: number }> = [
  { start: '06:00', end: '09:00', from: 360, to: 540 }, { start: '09:00', end: '12:00', from: 540, to: 720 },
  { start: '12:00', end: '15:00', from: 720, to: 900 }, { start: '15:00', end: '18:00', from: 900, to: 1080 },
  { start: '18:00', end: '21:00', from: 1080, to: 1260 },
];
export const SUGGESTION_WINDOW_DAYS = 90;
export function blockOf(d: Date): { weekday: number; start: string; end: string } | null {
  const { weekday, minutes } = istDay(d);
  const b = SUGGESTION_BLOCKS.find((x) => minutes >= x.from && minutes < x.to);
  return b ? { weekday, start: b.start, end: b.end } : null;
}
export interface PickupFact { pickedUpAt: Date; deliveryAttempts: number; delivered: boolean }
/**
 * "Run suggestions" — a READ, labelled "suggestion from your own pickup history": per weekday × block, the pickups the seller's
 * parcels actually had in 90 days, the delivery attempts made on them and how many were delivered at the FIRST delivery attempt.
 * No model and no write: the desk reads it and proposes; the member accepts or not. Ranked by first-attempt deliveries, then pickups.
 */
export function suggestionsFrom(facts: readonly PickupFact[]) {
  const cells = new Map<string, { weekday: number; start: string; end: string; pickups: number; attempted: number; firstAttempt: number }>();
  for (const f of facts) {
    const b = blockOf(f.pickedUpAt);
    if (!b) continue;
    const k = `${b.weekday}|${b.start}`;
    const c = cells.get(k) ?? { ...b, pickups: 0, attempted: 0, firstAttempt: 0 };
    c.pickups += 1;
    if (f.deliveryAttempts >= 1) c.attempted += 1;
    if (f.delivered && f.deliveryAttempts === 1) c.firstAttempt += 1;
    cells.set(k, c);
  }
  return [...cells.values()]
    .map((c) => ({ ...c, deliveryFirstAttempt: ratioBps(c.firstAttempt, c.attempted) }))
    .sort((a, b) => b.firstAttempt - a.firstAttempt || b.pickups - a.pickups || a.weekday - b.weekday || a.start.localeCompare(b.start));
}

/* ──────────────────────────────────────────── W232 · Village Run ──────────────────────────────────────────── */
/** "Parcels consolidated 13 / 32": parcels on the run ÷ open parcels bound for the route's villages that week. Both real counts. */
export function consolidation(onRun: number, boundForVillages: number) {
  return { onRun, boundForVillages, ratio: ratioBps(onRun, boundForVillages) };
}
/** The run week: the seven IST days ending on the run day (inclusive). */
export function runWeek(runDate: string): { from: string; to: string } {
  const d = new Date(`${runDate}T00:00:00Z`);
  const from = new Date(d.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  return { from, to: runDate };
}

/* ──────────────────────────────────────────── W234 · device ingest ──────────────────────────────────────────── */
export const INGEST_REPLAY_WINDOW_SECONDS = 300;
export const INGEST_NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const DEVICE_KEY_PREFIX = 'ccdk_';
/** A fresh device key: 32 random bytes, base64url, prefixed so a leaked one is recognisable. Shown ONCE. */
export function newDeviceKey(): string { return DEVICE_KEY_PREFIX + randomBytes(32).toString('base64url'); }
export const keyHint = (key: string) => key.slice(-4);
/** The signed string: `<unix seconds>.<nonce>.<raw body>` — the timestamp and nonce are inside the MAC, so neither can be swapped. */
export function ingestSigningString(ts: string, nonce: string, rawBody: string): string { return `${ts}.${nonce}.${rawBody}`; }
export function signIngest(key: string, ts: string, nonce: string, rawBody: string): string {
  return 'v1=' + createHmac('sha256', key).update(ingestSigningString(ts, nonce, rawBody)).digest('hex');
}
/** Constant-time check of `v1=<64 hex>` against the expected signature. Malformed → false (never a throw). */
export function verifyIngestSignature(key: string, ts: string, nonce: string, rawBody: string, header: string | null | undefined): boolean {
  if (typeof header !== 'string' || !/^v1=[0-9a-f]{64}$/.test(header)) return false;
  const want = Buffer.from(signIngest(key, ts, nonce, rawBody));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}
export type IngestHeaderRefusal = 'INGEST_DEVICE_HEADER' | 'INGEST_TIMESTAMP_HEADER' | 'INGEST_NONCE_HEADER' | 'INGEST_SIGNATURE_HEADER';
export function readIngestHeaders(h: Record<string, string | string[] | undefined>):
  { ok: true; deviceId: string; ts: string; nonce: string; signature: string } | { ok: false; code: IngestHeaderRefusal } {
  const one = (k: string) => { const v = h[k]; return Array.isArray(v) ? v[0] : v; };
  const deviceId = one('x-kv-device') ?? '';
  const ts = one('x-kv-timestamp') ?? '';
  const nonce = one('x-kv-nonce') ?? '';
  const signature = one('x-kv-signature') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) return { ok: false, code: 'INGEST_DEVICE_HEADER' };
  if (!/^\d{9,11}$/.test(ts)) return { ok: false, code: 'INGEST_TIMESTAMP_HEADER' };
  if (!INGEST_NONCE_RE.test(nonce)) return { ok: false, code: 'INGEST_NONCE_HEADER' };
  if (!/^v1=[0-9a-f]{64}$/.test(signature)) return { ok: false, code: 'INGEST_SIGNATURE_HEADER' };
  return { ok: true, deviceId: deviceId.toLowerCase(), ts, nonce, signature };
}
/** ±5 minutes around the server clock. */
export function ingestFreshness(tsSeconds: number, nowMs: number): 'fresh' | 'stale' | 'future' {
  const skew = nowMs / 1000 - tsSeconds;
  if (skew > INGEST_REPLAY_WINDOW_SECONDS) return 'stale';
  if (skew < -INGEST_REPLAY_WINDOW_SECONDS) return 'future';
  return 'fresh';
}

/* ──────────────────────────────────────────── W239 / W240 · breaches ──────────────────────────────────────────── */
export const COLD_CHAIN_SILENCE_MINUTES = 15;
export const BUYER_OFFER_AFTER_MINUTES = 15;
export const BREACH_LIST_MONTHS = 12;
export const BREACH_ACTS = ['acknowledge', 'record_action', 'record_outcome'] as const;
export type BreachAct = (typeof BREACH_ACTS)[number];
export const BREACH_OUTCOMES = ['accepted', 'accepted_with_test', 'rejected', 'loss_recorded', 'none'] as const;
export type BreachOutcome = (typeof BREACH_OUTCOMES)[number];
export const BUYER_DECISIONS = ['accept', 'accept_with_test', 'reject'] as const;
export type BuyerDecision = (typeof BUYER_DECISIONS)[number];
export interface BreachActState { acknowledgedAt: string | null; actionAt: string | null; outcome: string | null; closedAt: string | null }
/** Which acts a breach still offers. Each is once; an outcome waits until the readings are back in range (the DB says the same). */
export function breachActsFor(b: BreachActState): BreachAct[] {
  const out: BreachAct[] = [];
  if (!b.acknowledgedAt) out.push('acknowledge');
  if (!b.actionAt) out.push('record_action');
  if (!b.outcome && b.closedAt) out.push('record_outcome');
  return out;
}
/** "Median alert → action" over the breaches that have both an alert (opened) and an action — else refused by name. */
export function medianAlertToAction(rows: ReadonlyArray<{ openedAt: string; actionAt: string | null }>) {
  const secs = rows.filter((r) => r.actionAt).map((r) => (Date.parse(r.actionAt as string) - Date.parse(r.openedAt)) / 1000).filter((s) => s >= 0);
  const m = medianSeconds(secs);
  return m == null ? { kind: 'refused' as const, code: 'NO_ACTION_RECORDED', over: 0 } : { kind: 'measured' as const, seconds: m, over: secs.length,
    method: 'median of (action recorded − breach opened) over the breaches in the window that have an action recorded' };
}
/** "Loss": the recorded losses only (per currency), and how many breaches carry one. Never a guess, never a zero for "unknown". */
export function recordedLoss(rows: ReadonlyArray<{ lossMinor: string | null; lossCurrency: string | null }>) {
  const by = new Map<string, bigint>(); let n = 0;
  for (const r of rows) if (r.lossMinor != null && r.lossCurrency) { by.set(r.lossCurrency, (by.get(r.lossCurrency) ?? 0n) + BigInt(r.lossMinor)); n++; }
  return n === 0 ? { kind: 'none_recorded' as const, breachesWithLoss: 0 }
    : { kind: 'recorded' as const, breachesWithLoss: n, totals: [...by.entries()].map(([currency, minor]) => ({ currency, minor: minor.toString() })) };
}
