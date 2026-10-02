// modules/group-lots/domain/group-lot.events.ts · integration events published via the outbox (Law 4).
//   created / pledged / ready / listed — the lifecycle (no notice);
//   sale_settled — INTERNAL: enqueued on the relay's transaction when an order for a lot's listing completed (so it exists
//                  only if the seller's settlement committed); delivered back to this module, which records the sale and holds
//                  the proceeds in kv_app's unit of work;
//   sold — the sale is recorded and held;
//   deadline_extended / cancelled / nudge / settled — NOTICES (communication's notification map; copy in seed core/0007).
export const GroupLotEventType = {
  Created:          'group_lot.created',
  Pledged:          'group_lot.pledged',
  PledgeWithdrawn:  'group_lot.pledge_withdrawn',
  Ready:            'group_lot.ready',
  Listed:           'group_lot.listed',
  SaleSettled:      'group_lot.sale_settled',
  Sold:             'group_lot.sold',
  DeadlineExtended: 'group_lot.deadline_extended',
  Cancelled:        'group_lot.cancelled',
  Nudge:            'group_lot.nudge',
  SettlementPrepared: 'group_lot.settlement_prepared',
  SettlementRefused:  'group_lot.settlement_refused',
  Settled:          'group_lot.settled',
} as const;
export type DomainEvent = { type: string; payload: Record<string, unknown> };

/** Scale factor for quantity (numeric(14,3) → integer milli-units, float-free). */
export const QTY_SCALE = 1000n;
