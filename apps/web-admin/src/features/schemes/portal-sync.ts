// apps/web-admin/src/features/schemes/portal-sync.ts · W077 pure console logic (PC-56 ADMIN-SWEEP-c1).

export type AckLag = { kind: 'measured'; p50Hours: number; over: number } | { kind: 'unmeasured'; reason: string };

/** Measured lag prints with its sample size — a p50 over three rows must not read like a p50 over three thousand. */
export function ackLagText(lag: AckLag): { key: 'measured'; hours: string; over: string } | { key: 'unmeasured' } {
  if (lag.kind === 'measured') return { key: 'measured', hours: String(lag.p50Hours), over: String(lag.over) };
  return { key: 'unmeasured' };
}

/** Truth chips: there is no green here on purpose — nothing has earned one. */
export function truthClass(truth: string): string {
  return truth === 'mapped_never_pulled' ? 'kv-status kv-status--warn' : 'kv-status';
}
