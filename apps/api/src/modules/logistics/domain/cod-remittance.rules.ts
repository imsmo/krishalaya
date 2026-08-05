// modules/logistics/domain/cod-remittance.rules.ts · PC-55 A2 — the PURE cash rules, extracted so they are
// testable without a database and reusable by any surface (ops console, rider app, admin). The service calls
// exactly these; nothing re-implements them.
export const REMITTANCE_STATUSES = ['collected', 'deposited', 'reconciled', 'cancelled'] as const;
export type RemittanceStatus = (typeof REMITTANCE_STATUSES)[number];

/** Legal transitions. Reconciled is terminal; cancel is possible only before reconciliation. */
const NEXT: Readonly<Record<RemittanceStatus, readonly RemittanceStatus[]>> = Object.freeze({
  collected: ['deposited', 'cancelled'],
  deposited: ['reconciled', 'cancelled'],
  reconciled: [],
  cancelled: [],
});
export function canTransition(from: RemittanceStatus, to: RemittanceStatus): boolean {
  return (NEXT[from] ?? []).includes(to);
}

/** Sum the batch — bigint only, never float; an empty batch is not a batch. */
export function batchTotalMinor(shipments: ReadonlyArray<{ codMinor: bigint }>): bigint {
  return shipments.reduce((sum, s) => sum + s.codMinor, 0n);
}

/** The stale-worksheet guard: an expected figure must match the server's sum EXACTLY (string compare of
 *  minor units — no tolerance, no rounding; cash either matches or a human looks again). */
export function expectedMatches(expected: string | undefined, serverTotalMinor: bigint): boolean {
  return expected === undefined || expected === serverTotalMinor.toString();
}

/** MAKER ≠ CHECKER: whoever banked the cash may never be the one who reconciles it. */
export function canReconcile(status: RemittanceStatus, depositedBy: string | null, actorUserId: string): boolean {
  return status === 'deposited' && depositedBy !== actorUserId;
}
