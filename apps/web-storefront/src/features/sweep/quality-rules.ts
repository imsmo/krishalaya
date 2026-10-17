// apps/web-storefront/src/features/sweep/quality-rules.ts · PC-56 STORE-SWEEP-a · C1 (founder D1, money) — THE QUALITY PROMISE PRINTS WHAT THE CODE
// DOES, AND REFUSES THE REST BY NAME. PURE. The page (components/sweep/QualityPromiseScreen.tsx) is DERIVED from this list, and so is its render
// test: every rule names its MECHANISM (the code that makes it true) and, where the canon promised more, the refusal that answers it.
//
//   listing_grade        graded ONCE, at listing — the confirmed grade (2a); the dispatch re-grade refused (`regrade`)
//   window_online        orders PAID ONLINE: a window after delivery, the same for every category (order.entity.ts QUALITY_WINDOW_MS = 24 h); the
//                        order completes by itself when it closes (order-clocks.ts QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT) — "6 hours for
//                        perishables" refused
//   no_window_cod        PAY-ON-DELIVERY: no window — the person says "I received it"
//   dispute_text         a dispute is written text (create-dispute.dto.ts) — photos / the evidence board refused   [the `disputes` flag]
//   whole_payment_held   a dispute holds the WHOLE order payment in escrow (dispute-money-state.ts PARTIAL_FREEZE_BUILT = false) — "the
//                        disputed value only" refused                                                                  [the `disputes` flag]
//   moderator_decides    the organisation's moderator or the platform's desk decides (HOTFIX-7)                         [the `disputes` flag]
//   resolution_types     exactly RESOLUTION_TYPES: a full refund, a partial refund of a decided amount, a replacement, or rejected — future-order
//                        credits and "resolved in days" refused                                                         [the `disputes` flag]
//   refund_to_source     a refund goes back where the money came from, in full or in the decided amount (resolution-money.service.ts) —
//                        "arithmetic, not negotiation" refused (`partial_refund`)
//   cancel_per_order     the cancel rule is per order, on the order's page (3a) — the "ladder" page refused (`fee_ladder`)
//   trace_entry          the trace-code entry `/trace` (5b) — the demonstration lot refused (`trace_demo`)
//
// Under a store, the `disputes` flag decides the four dispute rules: OFF → "this organisation has not switched on disputes"; unreadable → said so.
// On the platform, the dispute rules print under "where an organisation switches disputes on".

/** The one quality window (hours) — the API's `QUALITY_WINDOW_MS / 3_600_000` (apps/api/src/modules/orders/domain/order.entity.ts:44,48). A
 *  drift spec (test/sweep-facts.spec.ts) reads that line, so this copy cannot silently disagree with the clock that runs. */
export const QUALITY_WINDOW_HOURS = 24;

export type QualityMechanism =
  | 'listing_grade' | 'window_online' | 'no_window_cod' | 'dispute_text' | 'whole_payment_held' | 'moderator_decides' | 'resolution_types'
  | 'refund_to_source' | 'cancel_per_order' | 'trace_entry';
export interface QualityRule {
  id: QualityMechanism;
  /** the sentence (sweep.quality.rule.<id>) */
  key: string;
  /** where the code makes it true */
  evidence: string;
  /** the refusal ids (features/sweep/refusals.ts) that answer what the canon promised beyond it */
  refused: readonly string[];
  /** a dispute rule: printed under a store only when its `disputes` flag is ON */
  disputes?: true;
  /** a link the rule carries */
  link?: 'trace' | 'orders';
}

export const QUALITY_RULES: readonly QualityRule[] = Object.freeze([
  { id: 'listing_grade', key: 'sweep.quality.rule.listing_grade', evidence: '2a: the confirmed grade only, on the listing', refused: ['regrade'] },
  { id: 'window_online', key: 'sweep.quality.rule.window_online', evidence: 'order.entity.ts QUALITY_WINDOW_MS (24 h, every category); auto-complete-quality-window.job.ts + order-clocks.ts (online-paid only)', refused: ['perishables_window'] },
  { id: 'no_window_cod', key: 'sweep.quality.rule.no_window_cod', evidence: 'order-clocks.ts QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT = true; "I received it" (3a) closes a pay-on-delivery order', refused: [] },
  { id: 'dispute_text', key: 'sweep.quality.rule.dispute_text', evidence: 'create-dispute.dto.ts / create-dispute-message.dto.ts: text only; the order page\'s door reads `disputes` (3a)', refused: ['dispute_photos'], disputes: true },
  { id: 'whole_payment_held', key: 'sweep.quality.rule.whole_payment_held', evidence: 'dispute-money-state.ts PARTIAL_FREEZE_BUILT = false — the gross stays in escrow', refused: ['escrow_freeze'], disputes: true },
  { id: 'moderator_decides', key: 'sweep.quality.rule.moderator_decides', evidence: 'HOTFIX-7: the organisation\'s moderator or the platform desk resolves', refused: ['resolved_in_days'], disputes: true },
  { id: 'resolution_types', key: 'sweep.quality.rule.resolution_types', evidence: 'disputes.events.ts RESOLUTION_TYPES = refund_full, refund_partial, replacement, rejected', refused: ['future_credits'], disputes: true },
  { id: 'refund_to_source', key: 'sweep.quality.rule.refund_to_source', evidence: 'resolution-money.service.ts: escrow −refund · source +refund (2c refund-to-source)', refused: ['partial_refund'] },
  { id: 'cancel_per_order', key: 'sweep.quality.rule.cancel_per_order', evidence: '3a: free with a full refund to source through `ready`, closed after pickup — said on each order', refused: ['fee_ladder', 'no_fine_print'], link: 'orders' },
  { id: 'trace_entry', key: 'sweep.quality.rule.trace_entry', evidence: '5b: /trace?code= → /trace/<code>, with its verify step', refused: ['trace_demo'], link: 'trace' },
] as QualityRule[]);

export type DisputesState = 'on' | 'off' | 'unknown';
/** Which rules print: on the platform every rule (the dispute ones under "where an organisation switches disputes on"); under a store the
 *  dispute rules only when its `disputes` flag is ON. */
export function rulesFor(chromeKind: 'platform' | 'tenant', disputes: DisputesState): QualityRule[] {
  if (chromeKind === 'platform' || disputes === 'on') return [...QUALITY_RULES];
  return QUALITY_RULES.filter((r) => !r.disputes);
}
/** A store's flag answer as a three-way state (a flag-store failure is NOT "off" — the page says it could not read it). */
export function disputesState(flags: { disputes?: boolean } | null | undefined): DisputesState {
  if (!flags) return 'unknown';
  return flags.disputes === true ? 'on' : 'off';
}
