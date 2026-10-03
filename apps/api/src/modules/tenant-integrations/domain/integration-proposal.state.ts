// modules/tenant-integrations/domain/integration-proposal.state.ts · PC-56 TENANT-13c · THE PROVIDER-CHANGE MACHINE IN ONE PLACE (Law 5).
//
//   proposed ──confirm (a DIFFERENT tenant_admin)──► confirmed ──verify ok → vault → write──► applied
//      │                                                 └──verify failed (nothing vaulted, nothing written)──► verify_failed
//      ├──refuse (reason)──► refused
//      └──7 days unconfirmed──► expired
//   confirmed for > 15 min (the process died between confirm and apply) ──► verify_failed ("interrupted")
//
// A disconnect has no verification: confirmed ──write──► applied. Closing ANY proposal wipes its sealed credential. The database holds
// the same machine (0193 `trg_ip_moves`, `ck_ip_credential_open`, the in-flight unique index); the connection row itself moves only in
// the transaction that applies a confirmed proposal (`trg_tenant_integrations_gate`).
export type ProposalKind = 'connect' | 'rotate' | 'disconnect';
export type ProposalStatus = 'proposed' | 'confirmed' | 'applied' | 'verify_failed' | 'refused' | 'expired';
export type ConnectionStatus = 'unverified' | 'verified' | 'verify_failed' | 'disconnected';
export const PROPOSAL_KINDS: readonly ProposalKind[] = ['connect', 'rotate', 'disconnect'];
export const IN_FLIGHT: readonly ProposalStatus[] = ['proposed', 'confirmed'];
export const CONFIRMED_STUCK_MINUTES = 15;

export function isProposalKind(k: string): k is ProposalKind { return (PROPOSAL_KINDS as readonly string[]).includes(k); }

/** Which kind a provider admits given its current connection — connect when none is live, rotate / disconnect when one is. */
export function kindVerdict(kind: ProposalKind, connection: { status: ConnectionStatus } | null): { ok: true } | { ok: false; code: 'ALREADY_CONNECTED' | 'NOT_CONNECTED' } {
  const live = connection !== null && connection.status !== 'disconnected';
  if (kind === 'connect') return live ? { ok: false, code: 'ALREADY_CONNECTED' } : { ok: true };
  return live ? { ok: true } : { ok: false, code: 'NOT_CONNECTED' };
}

/** The connection status a verification leaves behind. */
export function statusAfterCheck(ok: boolean): ConnectionStatus { return ok ? 'verified' : 'verify_failed'; }

/** The acts a proposal offers this viewer (the console's buttons; the trigger is the wall). */
export function proposalActs(p: { status: ProposalStatus; proposedBy: string; expiresAt: string }, viewer: string, nowMs: number) {
  const open = p.status === 'proposed' && Date.parse(p.expiresAt) > nowMs;
  return { canConfirm: open && p.proposedBy !== viewer, canRefuse: open };
}
