// modules/insights/domain/insights.ts · PC-56 TENANT-SW-f — the PURE rules of the tenant insights: W193 mandi pulse (the member-crop
// filter), W194 demand map (stock fit, value, reach), W195 wastage (measured loss from recorded facts only) — and the one list of every
// METHOD and every REFUSAL the API, the console and the export files print.
//
// THE HONESTY RULE (F-24 / F-27, 9d / 12). A number prints only where a published METHOD meets a RECORDED FACT. Each figure travels with
// its method code; each figure the platform has no fact for is REFUSED BY NAME (a code the console turns into a sentence). The method
// sentences are seeded en / hi / gu in `ui_messages` (seed core/0029, `insights.method.<code>`); the English here IS the seed's English
// (a spec reads the seed and compares) so the API, the console and the CSV can never say two different things.
//
// No model, no "AI band", no causal claim, no external statistic, no counterfactual: each of those is a refusal below, never a figure.
import { AppError } from '../../../shared/errors/app-error';
import { decodeKeyset, encodeKeyset, US_SQL, UUID_RE } from '../../../shared/pagination/us-keyset';

export const INSIGHTS_ZONE = 'Asia/Kolkata';

/* ──────────────────────────────────────────── refusals ──────────────────────────────────────────── */
export const REFUSED = {
  /** W193 "Stored stock (declared) 1,840 qtl": crop_seasons records yield only — nobody declares what is held in store. */
  storedStock: 'NO_STOCK_DECLARATION',
  /** W193 "Members who sold on an alert (30d)": a causal claim (alert → sale) with no published method (F-27). */
  soldOnAlert: 'NO_CAUSAL_METHOD',
  /** W193 "Band = platform AI (P10–P90, model v3.2, confidence 0.8410)": no registered model (12's law); price_predictions is empty. */
  aiBand: 'NO_REGISTERED_MODEL',
  /** W194 "Value" of a requirement that carries no per-unit budget. */
  demandValue: 'NO_PRICE_ON_REQUIREMENT',
  /** W194 "within reach of your districts" when this cooperative has no district on record (no region, no located listing). */
  geoReach: 'NO_GEO_REACH',
  /** W194 "Gap the other way (what buyers near you can't find)": no method for unmet demand. */
  unmetDemand: 'NO_UNMET_DEMAND_METHOD',
  /** W195 "India loses ~₹1.5L Cr/year": an external statistic with no source on this platform. */
  externalStatistic: 'EXTERNAL_STATISTIC_UNSOURCED',
  /** W195 "What saved money this quarter": savings are a counterfactual — no method. */
  savedMoney: 'NO_COUNTERFACTUAL_METHOD',
  /** W195 "weighbridge-at-both-ends": no weighbridge object exists. */
  weighbridge: 'NO_WEIGHBRIDGE_OBJECT',
  /** W2826 "record a manual wastage event": facts only (founder) — a loss is recorded by its source, never typed. */
  manualWastage: 'MANUAL_WASTAGE_REFUSED',
  /** W196 "runs on the analytics replica … 60s replica limit": no analytics replica is provisioned — the run is bounded on the primary. */
  analyticsReplica: 'NO_ANALYTICS_REPLICA',
  /** W196 "member (needs 360 grant)": the builder offers aggregates only; no member-level dimension. */
  memberDimension: 'MEMBER_DIMENSION_NOT_OFFERED',
  /** "exports are … signed": the file is unsigned (founder-physical key); its sha256 is printed. */
  signedExport: 'UNSIGNED_FOUNDER_PHYSICAL_KEY',
} as const;
export type InsightsRefusal = (typeof REFUSED)[keyof typeof REFUSED];
export type Refused = { kind: 'refused'; code: string };
export const refused = (code: string): Refused => ({ kind: 'refused', code });

/** The English sentence of every refusal — identical to seed core/0029 `insights.refusal.<CODE>` (en). */
export const REFUSAL_SENTENCES: Readonly<Record<InsightsRefusal, string>> = {
  NO_STOCK_DECLARATION: 'Stored stock is not shown: members declare crop seasons with a yield, never what they hold in store, so there is no stock declaration to add up. Listed stock (what is up for sale) is shown instead.',
  NO_CAUSAL_METHOD: 'Members who sold because of an alert is not shown: an alert followed by a sale is not proof the alert caused it, and no method for that claim is published.',
  NO_REGISTERED_MODEL: 'The price band is not shown: no price model is registered on this platform, so there is no band and no confidence to print.',
  NO_PRICE_ON_REQUIREMENT: 'Value is not shown: this requirement carries no per-unit budget, so quantity times a price cannot be computed.',
  NO_GEO_REACH: 'Within reach is not shown: this cooperative has no district on record (no region on the organisation and no located listing), so reach cannot be judged.',
  NO_UNMET_DEMAND_METHOD: 'What buyers near you cannot find is not shown: there is no published method for unmet demand.',
  EXTERNAL_STATISTIC_UNSOURCED: 'The national loss figure is not shown: it is an outside statistic with no source recorded on this platform.',
  NO_COUNTERFACTUAL_METHOD: 'What saved money is not shown: a saving is a loss that did not happen, and no method measures that.',
  NO_WEIGHBRIDGE_OBJECT: 'Weighbridge slips are not shown: no weighbridge record exists on this platform.',
  MANUAL_WASTAGE_REFUSED: 'A loss cannot be typed in: wastage is recorded only from its source (a refunded return, a rejected pour, a POD rejection or dispute, a recorded cold-chain loss).',
  NO_ANALYTICS_REPLICA: 'No analytics replica is provisioned: reports run on the primary database under a 60-second statement timeout, 92 days and 50,000 rows at most.',
  MEMBER_DIMENSION_NOT_OFFERED: 'Reports are aggregates: no member-level dimension is offered by the builder.',
  UNSIGNED_FOUNDER_PHYSICAL_KEY: 'The file is unsigned: signing needs a key held physically by the founder. Its sha256 is printed on the receipt.',
};

/* ──────────────────────────────────────────── methods ──────────────────────────────────────────── */
/** Every figure's METHOD. English identical to seed core/0029 `insights.method.<code>` (en); hi / gu live in the seed. */
export const METHODS = {
  member_crops: 'Member crops tracked = the distinct crops in a published listing of this cooperative today, or declared in a crop season (planned, sown or harvested) of this year or last. Source: listings, crop seasons.',
  mandi_modal: 'Modal = the latest accepted modal price observed at that mandi for the crop in the last 14 days, as published; change = against the same mandi\'s previous earlier day, in basis points, truncated toward zero. Source: mandi prices.',
  listed_stock: 'Listed stock = the quantity still available on this cooperative\'s published listings, per crop and unit. It is what is up for sale, not what is held in store. Source: listings.',
  alerts_active: 'Price alerts active = alerts members set for themselves that are switched on today. Source: price alerts.',
  alerts_fired: 'Fired this week = alert triggers recorded since Monday 00:00 IST. Source: price alert triggers.',
  qty_wanted: 'Quantity wanted = the requirement\'s quantity less what has already been accepted against it, in its own unit. Source: requirements.',
  stock_fit: 'Member stock fit = the quantity available on this cooperative\'s published listings of the same crop in the same unit (the buyer\'s own excluded), against the quantity wanted: covers, partial or none. Aggregates only; a member\'s own figures appear only after that member consented to a quote on this requirement. Source: listings, requirement consents.',
  demand_value: 'Value = quantity wanted × the buyer\'s per-unit budget ceiling (and floor, when posted), in the requirement\'s currency, rounded down. Source: requirements.',
  geo_reach: 'Within reach = the delivery pincode maps (pincode → district) to a district where this cooperative is registered or holds a located published listing. A requirement without a mapped pincode is counted as unknown, never as near. Source: pincodes, regions, listings.',
  measured_loss: 'Measured loss = the money value each source recorded for a loss in the window, per currency: the refund on a returned order, the priced amount of a rejected milk pour, the refund of a dispute opened from a POD rejection, a recorded cold-chain loss, a POD reviewer\'s entered variance. A POD rejection and the dispute it opened count once (the dispute\'s refund when it exists). Losses with no recorded money value are counted by quantity, per unit, beside it. Source: wastage events.',
  loss_share: 'Share of GMV = measured loss ÷ the goods value of orders completed in the same window (the AGM method), in basis points, rounded down; shown only when both are in one currency.',
  loss_split: 'Split = the same measured loss by where its source places it: transit (POD rejections, POD disputes, shipment cold chain), storage (other cold chain), milk (rejected pours, cooler cold chain), other (returns).',
} as const;
export type MethodCode = keyof typeof METHODS;

/* ──────────────────────────────────────────── shared numbers ──────────────────────────────────────────── */
/** A part of a whole in basis points, rounded DOWN; null when the whole is not positive. BigInt — money never meets a float. */
export function shareBps(part: bigint, whole: bigint): number | null {
  if (whole <= 0n || part < 0n) return null;
  return Number((part * 10_000n) / whole);
}

/** "12.500" (numeric(14,3) as text) → thousandths as a bigint. Refuses anything that is not a non-negative decimal. */
export function thousandths(q: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(q).trim());
  if (!m) throw new Error(`not a quantity: ${q}`);
  return BigInt(m[1]) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0'));
}
export function fromThousandths(t: bigint): string {
  const neg = t < 0n; const a = neg ? -t : t;
  const whole = a / 1000n; const frac = a % 1000n;
  return `${neg ? '-' : ''}${whole}${frac === 0n ? '' : '.' + frac.toString().padStart(3, '0').replace(/0+$/, '')}`;
}

/** Monday 00:00 in IST of the week holding `now` — "this week" for "fired this week". */
export function istWeekStart(now: Date): Date {
  const t = new Date(now.getTime() + 330 * 60_000);             // IST wall clock, read with the UTC getters
  const dow = (t.getUTCDay() + 6) % 7;                           // 0 = Monday
  const mondayIst = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - dow, 0, 0, 0);
  return new Date(mondayIst - 330 * 60_000);
}

/* ──────────────────────────────────────────── W194 · demand ──────────────────────────────────────────── */
export type StockFit = 'covers' | 'partial' | 'none';
/** Listed stock against the quantity still wanted (thousandths, same unit). */
export function stockFit(wanted: bigint, stock: bigint): StockFit {
  if (stock <= 0n) return 'none';
  return stock >= wanted ? 'covers' : 'partial';
}

/** The requirement's value: quantity × per-unit budget (floor), in minor units — or refused when there is no budget. */
export function demandValue(wantedQty: string, budgetMinMinor: string | null, budgetMaxMinor: string | null):
  { kind: 'value'; upToMinor: string; fromMinor: string | null } | Refused {
  if (budgetMaxMinor === null || !/^\d+$/.test(budgetMaxMinor) || BigInt(budgetMaxMinor) <= 0n) return refused(REFUSED.demandValue);
  const q = thousandths(wantedQty);
  const up = (q * BigInt(budgetMaxMinor)) / 1000n;
  const from = budgetMinMinor !== null && /^\d+$/.test(budgetMinMinor) && BigInt(budgetMinMinor) > 0n ? ((q * BigInt(budgetMinMinor)) / 1000n).toString() : null;
  return { kind: 'value', upToMinor: up.toString(), fromMinor: from };
}

export type Reach = 'in_reach' | 'out_of_reach' | 'unknown';
/** A requirement's reach: its delivery pincode's district against the cooperative's districts. */
export function reachOf(requirementDistrict: string | null, tenantDistricts: ReadonlySet<string>): Reach {
  if (!requirementDistrict) return 'unknown';
  return tenantDistricts.has(requirementDistrict) ? 'in_reach' : 'out_of_reach';
}

/* ──────────────────────────────────────────── W195 · wastage ──────────────────────────────────────────── */
export const WASTAGE_WINDOW_DAYS = 90;
export const WASTAGE_KINDS = ['transit', 'storage', 'milk', 'other'] as const;
export const WASTAGE_SOURCES = ['return_accepted', 'dairy_pour_rejected', 'transit_dispute_variance', 'cold_chain_loss', 'pod_rejection'] as const;
export const WASTAGE_SOURCE_TABLES = ['returns', 'milk_quality_reviews', 'disputes', 'cold_chain_breaches', 'pod_reviews'] as const;
export type WastageSourceTable = (typeof WASTAGE_SOURCE_TABLES)[number];
export const WASTAGE_RERUN_REASON_MIN = 10;

/** One aggregated line of the deduplicated window: a kind, a currency or a unit, a count and sums (as text). */
export interface LossLine { kind: string; currency: string | null; unit: string | null; events: number; valueMinor: string | null; quantity: string | null }

export interface MeasuredLoss {
  windowDays: number;
  events: number;
  byCurrency: Array<{ currency: string; valueMinor: string; events: number }>;
  byUnit: Array<{ unit: string; quantity: string; events: number }>;
  /** events whose source recorded neither a money value nor a quantity — counted, never valued */
  withoutValueOrQuantity: number;
  split: Array<{ kind: string; byCurrency: Array<{ currency: string; valueMinor: string }>; byUnit: Array<{ unit: string; quantity: string }>; events: number }>;
}

/** Fold the deduplicated lines into the W195 tiles. Integers only: bigint for money, thousandths for quantities. */
export function measuredLoss(lines: readonly LossLine[], windowDays = WASTAGE_WINDOW_DAYS): MeasuredLoss {
  const cur = new Map<string, { v: bigint; n: number }>(); const unit = new Map<string, { q: bigint; n: number }>();
  const kinds = new Map<string, { cur: Map<string, bigint>; unit: Map<string, bigint>; n: number }>();
  let events = 0; let none = 0;
  for (const l of lines) {
    events += l.events;
    const k = kinds.get(l.kind) ?? { cur: new Map(), unit: new Map(), n: 0 };
    k.n += l.events;
    if (l.currency && l.valueMinor !== null) {
      const c = cur.get(l.currency) ?? { v: 0n, n: 0 }; c.v += BigInt(l.valueMinor); c.n += l.events; cur.set(l.currency, c);
      k.cur.set(l.currency, (k.cur.get(l.currency) ?? 0n) + BigInt(l.valueMinor));
    } else if (l.unit && l.quantity !== null) {
      const u = unit.get(l.unit) ?? { q: 0n, n: 0 }; u.q += thousandths(l.quantity); u.n += l.events; unit.set(l.unit, u);
      k.unit.set(l.unit, (k.unit.get(l.unit) ?? 0n) + thousandths(l.quantity));
    } else {
      none += l.events;
    }
    kinds.set(l.kind, k);
  }
  const sortKeys = <T,>(m: Map<string, T>) => [...m.keys()].sort();
  return {
    windowDays, events, withoutValueOrQuantity: none,
    byCurrency: sortKeys(cur).map((c) => ({ currency: c, valueMinor: cur.get(c)!.v.toString(), events: cur.get(c)!.n })),
    byUnit: sortKeys(unit).map((u) => ({ unit: u, quantity: fromThousandths(unit.get(u)!.q), events: unit.get(u)!.n })),
    split: WASTAGE_KINDS.filter((k) => kinds.has(k)).map((k) => {
      const v = kinds.get(k)!;
      return { kind: k, events: v.n,
        byCurrency: sortKeys(v.cur).map((c) => ({ currency: c, valueMinor: v.cur.get(c)!.toString() })),
        byUnit: sortKeys(v.unit).map((u) => ({ unit: u, quantity: fromThousandths(v.unit.get(u)!) })) };
    }),
  };
}

/** Loss ÷ GMV in the same window — only when both sides are exactly one currency and the same one. */
export function lossShareOfGmv(loss: MeasuredLoss, gmv: Array<{ currency: string; goodsMinor: string }>):
  { kind: 'share'; bps: number; currency: string; lossMinor: string; gmvMinor: string } | Refused {
  if (loss.byCurrency.length !== 1 || gmv.length !== 1 || loss.byCurrency[0].currency !== gmv[0].currency) {
    return refused(gmv.length === 0 || BigInt(gmv[0]?.goodsMinor ?? '0') <= 0n ? 'NO_GMV' : (loss.byCurrency.length === 0 ? 'NO_MEASURED_LOSS' : 'MIXED_CURRENCY'));
  }
  const bps = shareBps(BigInt(loss.byCurrency[0].valueMinor), BigInt(gmv[0].goodsMinor));
  if (bps === null) return refused('NO_GMV');
  return { kind: 'share', bps, currency: gmv[0].currency, lossMinor: loss.byCurrency[0].valueMinor, gmvMinor: gmv[0].goodsMinor };
}

/* ──────────────────────────────────────────── errors ──────────────────────────────────────────── */
export class InsightsRefusedError extends AppError {
  constructor(code: string, message: string, status = 409, details: Record<string, unknown> = {}) { super(code, message, status, { code, ...details }); }
}

/* ──────────────────────────────────────────── µs cursors ──────────────────────────────────────────── */
// The platform's one microsecond keyset (9a's `shared/pagination/us-keyset`): the instant as the database printed it (six fractional
// digits), compared in SQL as timestamptz — never through a JS Date (F-14).
export function encodeUsCursor(us: string, id: string): string { return encodeKeyset(us, id); }
export function decodeUsCursor(c: string | undefined | null): { us: string; id: string } | null {
  const k = decodeKeyset(c, UUID_RE);
  return k ? { us: k.ts, id: k.id } : null;
}
/** A SELECT expression giving a timestamptz column as an ISO instant with SIX fractional digits, in UTC. */
export const usSql = US_SQL;
