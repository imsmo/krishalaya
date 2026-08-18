// apps/web-admin/src/features/schemes/portal-sync.ts · W077 pure console logic (PC-56 ADMIN-SWEEP-c1).
//
// DEV-60 (UI Port Program batch 3, Part 1): `truthClass` now returns a `StatusTone` instead of a raw `kv-status`
// string — disposition (c), same pattern as `ai-governance.ts`. Call site renders `<StatusPill tone={...}
// label={...}/>` per the founder's pill-per-canon ruling for the `kv-status` family.

import type { StatusTone } from '@krishalaya/ui';

export type AckLag = { kind: 'measured'; p50Hours: number; over: number } | { kind: 'unmeasured'; reason: string };

/** Measured lag prints with its sample size — a p50 over three rows must not read like a p50 over three thousand. */
export function ackLagText(lag: AckLag): { key: 'measured'; hours: string; over: string } | { key: 'unmeasured' } {
  if (lag.kind === 'measured') return { key: 'measured', hours: String(lag.p50Hours), over: String(lag.over) };
  return { key: 'unmeasured' };
}

/** Truth chips: there is no success tone here on purpose — nothing has earned one. */
export function truthTone(truth: string): StatusTone {
  return truth === 'mapped_never_pulled' ? 'warning' : 'neutral';
}
