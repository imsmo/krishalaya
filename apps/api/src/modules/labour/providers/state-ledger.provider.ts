// modules/labour/providers/state-ledger.provider.ts · PC-55 A4 — the NREGASoft (state ledger) PORT.
// WHY A PORT: MGNREGA's authoritative record lives in the state's NREGASoft system; access is granted by a
// state department, not by code. Rule Zero: wire it end-to-end NOW behind an interface, ship a noop that says
// "not synced" out loud, and let the real integration be a config switch — never a rewrite, and never a fake.
//
// LAW: this port NEVER moves money (MGNREGA wages are paid by the state into the worker's own account) and
// NEVER silently overwrites what an operator recorded. A real sync will land rows with source='state_sync'
// so the two assertions stay distinguishable forever.
export const STATE_LEDGER_PROVIDER = 'STATE_LEDGER_PROVIDER';

export interface StateLedgerCardStatus {
  jobCardNo: string;
  daysUsedFy: number | null;      // the state's own figure
  fyLabel: string | null;         // e.g. '2026-27'
  asOf: string | null;            // when the state computed it
}
export interface StateLedgerSyncResult {
  /** true ONLY when a real state system answered. The noop never claims it. */
  providerAvailable: boolean;
  note: string;                   // shown verbatim on every surface
  cards: StateLedgerCardStatus[];
  fetchedAt: string;
}

export interface StateLedgerProvider {
  readonly name: string;
  /** Pull the state's day-count for the given job cards (read-only; the platform reconciles, never rewrites). */
  fetchCardStatus(jobCardNos: string[]): Promise<StateLedgerSyncResult>;
}

export class NoopStateLedgerProvider implements StateLedgerProvider {
  readonly name = 'noop';
  async fetchCardStatus(_jobCardNos: string[]): Promise<StateLedgerSyncResult> {
    return {
      providerAvailable: false,
      note: 'NREGASoft state-ledger sync is pending (state department onboarding). The day counts shown here are '
          + 'what THIS platform observed from recorded musters — the state ledger remains authoritative.',
      cards: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/** Env switch; unknown/absent ⇒ noop (fail closed). */
export function stateLedgerProviderFromEnv(env: Record<string, string | undefined>): StateLedgerProvider {
  switch ((env.STATE_LEDGER_PROVIDER ?? 'noop').toLowerCase()) {
    case 'noop':
    default:
      return new NoopStateLedgerProvider();
    // case 'nregasoft': return new NregaSoftProvider(...)  ← lands with the state credentials.
  }
}
