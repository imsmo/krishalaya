// modules/schemes/providers/pfms.provider.ts · PC-55 A3 — the PFMS PORT.
// WHY A PORT AND NOT AN INTEGRATION: PFMS (the Government of India's Public Financial Management System) is
// onboarded by a government process, not by writing code. Rule Zero says take the expensive-but-honest path:
// the platform is wired END TO END against this interface NOW, with a NOOP implementation that says
// "provider pending" out loud, so the day the credentials land it is a config switch (PFMS_PROVIDER=live) and
// not a rewrite — and until that day NOTHING pretends a reconciliation happened.
//
// LAW: this port NEVER moves money. PFMS is the paying rail; the platform RECORDS what it reports (credits via
// the existing per-application POST, returns via the A3 bounce ledger). No method here writes to any ledger.
export const PFMS_PROVIDER = 'PFMS_PROVIDER';

export interface PfmsReconRequest {
  schemeId: string;
  from: string;               // ISO date (inclusive)
  to: string;                 // ISO date (inclusive)
  pfmsRefs?: string[];        // narrow the pull to specific references when known
}
export interface PfmsCreditRecord {
  pfmsRef: string; userAccountLast4: string | null; amountMinor: string; creditedOn: string;
  status: 'credited' | 'returned'; returnReasonCode?: string; returnNarration?: string; bankRef?: string;
}
export interface PfmsReconResult {
  /** true only when a REAL provider answered. The noop never claims this. */
  providerAvailable: boolean;
  /** Honest, human-readable state for every surface to show verbatim. */
  note: string;
  records: PfmsCreditRecord[];
  fetchedAt: string;
}

export interface PfmsProvider {
  readonly name: string;
  /** Pull what PFMS says about a window. The platform then compares against its own observations. */
  fetchRecon(req: PfmsReconRequest): Promise<PfmsReconResult>;
}

/** The default in every environment until the government integration is live. */
export class NoopPfmsProvider implements PfmsProvider {
  readonly name = 'noop';
  async fetchRecon(_req: PfmsReconRequest): Promise<PfmsReconResult> {
    return {
      providerAvailable: false,
      note: 'PFMS provider integration is pending (government onboarding). Bounces recorded here are the ones '
          + 'officers entered from bank/PFMS statements; no automatic pull has run.',
      records: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

/** Env switch. Unknown/absent value ⇒ noop (fail closed, never a silent fake). */
export function pfmsProviderFromEnv(env: Record<string, string | undefined>): PfmsProvider {
  switch ((env.PFMS_PROVIDER ?? 'noop').toLowerCase()) {
    case 'noop':
    default:
      return new NoopPfmsProvider();
    // case 'live': return new LivePfmsProvider(...)  ← lands with the credentials; the port does not change.
  }
}
