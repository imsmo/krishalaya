// apps/admin-api/src/modules/schemes-registry-ops/domain/portal-sync.ts · W077 pure rules (PC-56 ADMIN-SWEEP-c1).
//
// THE REGISTRY TELLS THE TRUTH ABOUT A SYNC THAT HAS NEVER RUN. No portal job exists in the worker, no client for
// any government portal exists anywhere (PFMS is an explicit Noop; iKhedut has no client at all), so:
//   • "Last pull" is NEVER, for every portal, and the word is 'never', not a dash that reads as recent;
//   • "Health" cannot be 'healthy' — a portal nobody has called has no health, only a mapping state;
//   • "Ack lag p50" is measured over rows 0136's clock has stamped, and 'unmeasured' until any exist —
//     never a figure invented from updated_at.
// The canon's "Run all pulls" and its W2214 chain are NOT built: with no worker to consume a run request, queueing
// one would be a status recording an act nobody performs (ADMIN-10-Q1's shape, refused for the second time). And
// `schemes.sync` is deliberately NOT added to the catalog — a permission with no route behind it is a promise
// nothing keeps (0120's rule); the read below is registry data and rides on `schemes.registry.read`.

/** What the health column may honestly say. There is no 'healthy' and no 'degraded' in this vocabulary, because
 *  both claim knowledge of a portal's behaviour and no exchange has ever happened. */
export type PortalTruth = 'mapped_never_pulled' | 'manual';

export function portalTruth(hasMapping: boolean): PortalTruth {
  return hasMapping ? 'mapped_never_pulled' : 'manual';
}

/** Ack lag, over exactly the rows that can answer (both timestamps present). Unknown ≠ zero, again. */
export type AckLag = { kind: 'measured'; p50Hours: number; over: number } | { kind: 'unmeasured'; reason: string };

export function ackLag(ackedN: number, p50Hours: number | null): AckLag {
  if (ackedN > 0 && p50Hours !== null) return { kind: 'measured', p50Hours, over: ackedN };
  return {
    kind: 'unmeasured',
    reason: 'no acknowledgement has been recorded since the clock started (0136) — historic refs carry no timestamp, and a p50 over invented times would be worse than none',
  };
}

/** Pending pushes is a REAL figure with a precise meaning; the basis travels with it so the number cannot outlive
 *  its definition. */
export function pendingPushes(n: number): { n: number; basis: string } {
  return { n, basis: 'applications submitted on-platform whose portal acknowledgement number has not been recorded' };
}

/** Whether the mapping registry itself has ever claimed a sync — pinned FALSE by the registry-ops rule
 *  (sync_status is written 'pending', never 'synced'). Surfaced so the console can assert it in words. */
export function neverSynced(rows: readonly { syncStatus: string; lastSyncedAt: string | null }[]): boolean {
  return rows.every((r) => r.syncStatus !== 'synced' && r.lastSyncedAt === null);
}
