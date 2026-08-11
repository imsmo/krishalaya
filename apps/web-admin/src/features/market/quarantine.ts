// apps/web-admin/src/features/market/quarantine.ts · the anomaly worklist's view rules (PC-56 ADMIN-SWEEP).
//
// Mirrors the admin-api domain deliberately rather than importing across app boundaries — and every rule here is
// asserted in `src/test/sweep-mandi-pulse.spec.ts` against the same fixtures the server spec uses, so the two cannot
// drift the way ADMIN-11's flag preview drifted from its evaluator.

/** How loud a held observation is. A 10× typo and a 25% one are both held and are not the same call. */
export function severityKey(deviationBp: number | null): string {
  if (deviationBp === null) return 'mp11.sev.unknown';
  if (deviationBp >= 10_000) return 'mp11.sev.extreme';
  return deviationBp >= 5_000 ? 'mp11.sev.high' : 'mp11.sev.moderate';
}

export function severityClass(deviationBp: number | null): string {
  if (deviationBp === null) return 'kv-badge is-warn';
  return deviationBp >= 10_000 ? 'kv-badge is-danger' : 'kv-badge is-warn';
}

/** Whether the decide controls are offered. ABSENT on a decided row, not disabled: deciding again would overwrite the
 *  note the reporting ambassador was shown, which is the coaching this platform gives instead of a reprimand. */
export function canDecide(state: string): boolean {
  return state === 'quarantined';
}

export function decidedNoticeKey(state: string): string | null {
  if (state === 'quarantined') return null;
  if (state === 'released') return 'mp11.decided.released';
  if (state === 'rejected') return 'mp11.decided.rejected';
  return 'mp11.decided.notHeld';
}
