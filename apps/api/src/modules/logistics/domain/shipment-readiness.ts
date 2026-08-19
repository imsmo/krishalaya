// modules/logistics/domain/shipment-readiness.ts · WHEN MAY THE WHEELS TURN, AND WHAT PROVES POSSESSION
// CHANGED HANDS (PC-56 TENANT-5a). Pure rules — no I/O, no clock of its own.
//
// W226 states this as settled policy, in the copy under its own table:
//
//   "A shipment for a `payment_pending` order stays `pending` — wheels never turn before money clears
//    (the cumin row shows exactly this)."
//
// **NOTHING ENFORCED IT.** `ShipmentService.create` takes an `orderId`, checks only that no shipment already
// exists for it, and inserts — it never reads the order. Neither do `assign`, `schedulePickup` or
// `markPickedUp`. So a shipment against an unpaid order could be created, assigned a driver, scheduled,
// picked up from a farmer's gate and delivered, and every one of those steps would succeed. The rule the
// screen prints as the reason its cumin row is still `pending` was a sentence, not a gate.
//
// And W225's second philosophy line:
//
//   "OTP at pickup AND delivery — possession changes hands with proof, both directions"
//
// `shipments.pickup_otp_hash` has existed since 0007. **It is written by nothing.** `markOutForDelivery`
// issues the DELIVERY otp; `markPickedUp()` sets a timestamp and moves the state. So a farmer hands over
// twelve quintals at their own gate with no proof of the handover at all — which is exactly the dispute
// W227 says the ritual exists to prevent.
import { OrderStatus } from '../../orders/domain/order.state';
import { ShipmentStatus } from './shipment.state';

/* --------------------------------------------------------------------------------------------------------- */
/* THE MONEY GATE                                                                                            */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * The order statuses that mean the sale is not yet agreed and paid for.
 *
 * `created` and `payment_pending` only. NOT a list of "good" statuses inverted, deliberately: a new order
 * status added later must default to ALLOWING transport rather than silently freezing every shipment on the
 * platform, and the two states that mean "no money yet" are the closed, knowable set. `confirmed` is the
 * line the order machine itself draws — `payment_pending → confirmed` is the transition money causes.
 *
 * **COD IS NOT AN EXCEPTION AND MUST NOT BE MADE ONE.** A cash-on-delivery order still reaches `confirmed`
 * when the sale is agreed; the cash arrives at the door. The gate is about the ORDER being real, not about
 * the money being in the wallet, which is why it is expressed against the order's own state machine and not
 * against a payment row.
 */
export const PRE_MONEY_ORDER_STATUSES: readonly OrderStatus[] = ['created', 'payment_pending'];

export function orderIsPreMoney(status: OrderStatus | string): boolean {
  return (PRE_MONEY_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * A cancelled or refunded order must not have wheels turning either, and for a different reason: the sale is
 * over. Separated from the pre-money set because the operator sentence is different — "not yet" versus
 * "no longer" — and a console that says the wrong one sends somebody to chase a payment that will never come.
 */
export const DEAD_ORDER_STATUSES: readonly OrderStatus[] = ['cancelled', 'refunded'];

export type TransportVerdict =
  /** The order is agreed and paid for (or COD-agreed): transport may proceed. */
  | { kind: 'may_move' }
  /** The order has not been paid for yet. The shipment stays `pending` and the screen says why. */
  | { kind: 'awaiting_payment'; orderStatus: string }
  /** The sale is over. A shipment against it should be cancelled, not scheduled. */
  | { kind: 'order_closed'; orderStatus: string }
  /**
   * The order could not be read. **REFUSE, AND SAY SO.** This is the one that must not default to
   * `may_move`: an unreadable order is exactly the state a caller would like to treat as "probably fine",
   * and treating it as permission is how a gate becomes decorative. Law 12 says degrade, never die — for a
   * READ that means show less, and for a WRITE THAT MOVES GOODS it means refuse.
   */
  | { kind: 'unknown_order' };

export function transportVerdict(orderStatus: OrderStatus | string | null | undefined): TransportVerdict {
  if (typeof orderStatus !== 'string' || orderStatus === '') return { kind: 'unknown_order' };
  if (orderIsPreMoney(orderStatus)) return { kind: 'awaiting_payment', orderStatus };
  if ((DEAD_ORDER_STATUSES as readonly string[]).includes(orderStatus)) return { kind: 'order_closed', orderStatus };
  return { kind: 'may_move' };
}

/**
 * The shipment actions the money gate governs — the ones that COMMIT SOMEBODY: a driver's afternoon, a
 * farmer waiting at a gate, a vehicle. Everything before them is planning.
 *
 * `create` is deliberately NOT here. A shipment row for an unpaid order is legitimate and is what W226's
 * cumin row IS — `pending`, visible, waiting on money. Refusing to create it would mean the desk could not
 * see the work coming, and the operator would plan the Saturday run blind. What the gate refuses is the
 * shipment LEAVING `pending`.
 */
export const MONEY_GATED_ACTIONS = ['assign', 'schedule_pickup', 'picked_up'] as const;
export type MoneyGatedAction = (typeof MONEY_GATED_ACTIONS)[number];

export function isMoneyGated(action: string): action is MoneyGatedAction {
  return (MONEY_GATED_ACTIONS as readonly string[]).includes(action);
}

/* --------------------------------------------------------------------------------------------------------- */
/* POSSESSION, BOTH DIRECTIONS                                                                               */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * Does this shipment need a PICKUP otp before it may be marked picked up?
 *
 * Every shipment collected from a person does. The exception is not a policy choice, it is a physical one: a
 * shipment whose goods never leave the tenant's own premises has nobody to hand them over. That is expressed
 * by the caller passing `fromOwnPremises`, because the entity cannot know it.
 *
 * **THE OTP IS ISSUED AT SCHEDULE TIME, NOT AT PICKUP TIME**, and that ordering is the whole point. The code
 * has to reach the SELLER before the driver arrives, or the driver stands at a gate reading out a number the
 * farmer is supposed to be checking — which proves nothing. `markOutForDelivery` already does exactly this
 * for the delivery side; this is the missing mirror of it.
 */
export function pickupOtpRequired(p: { fromOwnPremises: boolean }): boolean {
  return !p.fromOwnPremises;
}

export type PossessionProof = 'both_ends' | 'delivery_only' | 'pickup_only' | 'neither';

/**
 * What this shipment can actually PROVE about possession. Rendered by the console, and it is the honest
 * version of W225's tick: a shipment carrying only a delivery OTP says `delivery_only`, never "both".
 *
 * Pre-wave shipments report `delivery_only` at best and `neither` at worst, and the screen must say so
 * rather than back-filling a claim about a handover nobody witnessed.
 */
export function possessionProof(p: { pickupOtpHash: string | null; deliveryOtpHash: string | null }): PossessionProof {
  const pickup = !!p.pickupOtpHash;
  const delivery = !!p.deliveryOtpHash;
  if (pickup && delivery) return 'both_ends';
  if (delivery) return 'delivery_only';
  if (pickup) return 'pickup_only';
  return 'neither';
}

/* --------------------------------------------------------------------------------------------------------- */
/* A FAILURE WITH NO NEXT STEP CANNOT EXIST                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W226: "Failed deliveries auto-schedule one free re-attempt before returning."
 * W236: "a failure without a next step cannot exist in this table."
 *
 * ONE free re-attempt, then the shipment returns. The counter is what makes "one" a number rather than an
 * adjective — `markFailed(reason)` moved the state and counted nothing, so "one free re-attempt" had no
 * mechanism and no way to tell a first failure from a fifth.
 */
export const FREE_REATTEMPTS = 1;

export type FailureOutcome =
  /** Under the free-re-attempt ceiling: the shipment goes back out. */
  | { kind: 'reattempt'; attemptNo: number }
  /** The free re-attempt is spent: the goods go back to the seller. */
  | { kind: 'return'; attemptNo: number };

/**
 * What happens after a failed delivery. `deliveryAttempts` is the count BEFORE this failure, so the first
 * failure arrives with 0 and produces attempt 1.
 *
 * Pure, and deliberately not a scheduler: it says what should happen next, and the caller books it. The
 * WHEN of a re-attempt is a slot decision (W227's pickup windows) and inventing a time here would be this
 * file deciding a driver's afternoon.
 */
export function failureOutcome(deliveryAttempts: number): FailureOutcome {
  const attemptNo = Math.max(0, Math.floor(deliveryAttempts)) + 1;
  return attemptNo > FREE_REATTEMPTS ? { kind: 'return', attemptNo } : { kind: 'reattempt', attemptNo };
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT THE CONSOLE MAY CLAIM                                                                                */
/* --------------------------------------------------------------------------------------------------------- */

/** The four tabs W226 draws, and the statuses behind each. `all` is not a tab: the canon's counts are
 *  active / pending / delivered (7d) / failed+returned, and a fifth bucket would be a number nobody asked
 *  for. `cancelled` belongs to none of them and is reachable by filter — a cancelled shipment is not work. */
export const SHIPMENT_TABS = ['active', 'pending', 'delivered', 'failed'] as const;
export type ShipmentTab = (typeof SHIPMENT_TABS)[number];

export function isShipmentTab(v: string | undefined): v is ShipmentTab {
  return !!v && (SHIPMENT_TABS as readonly string[]).includes(v);
}

export function statusesForTab(tab: ShipmentTab): readonly ShipmentStatus[] {
  switch (tab) {
    case 'pending':   return ['pending'];
    case 'delivered': return ['delivered'];
    case 'failed':    return ['failed', 'returned'];
    // "Active" is everything with wheels under it or about to have: assigned through out_for_delivery.
    // `pending` is excluded on purpose — it has its own tab and its own meaning (usually: unpaid).
    default:          return ['assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'at_hub', 'out_for_delivery'];
  }
}

/**
 * W226's "Next milestone" column — the ONE thing this shipment is waiting for.
 *
 * Derived from the status rather than stored, because a stored "next step" is a status column recording an
 * act nobody performed (this programme's most-found defect) and it would go stale the moment the shipment
 * moved. `null` means the shipment is finished and the column shows a dash, not an invented next step.
 */
export function nextMilestone(status: ShipmentStatus): 'assign_driver' | 'schedule_pickup' | 'pickup' | 'transit' | 'deliver' | null {
  switch (status) {
    case 'pending':          return 'assign_driver';
    case 'assigned':         return 'schedule_pickup';
    case 'pickup_scheduled': return 'pickup';
    case 'picked_up':
    case 'in_transit':
    case 'at_hub':           return 'transit';
    case 'out_for_delivery': return 'deliver';
    case 'failed':           return 'deliver';   // a failure's next step is the re-attempt (see failureOutcome)
    default:                 return null;        // delivered / returned / cancelled
  }
}
