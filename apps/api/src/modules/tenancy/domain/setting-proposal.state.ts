// modules/tenancy/domain/setting-proposal.state.ts · PC-56 TENANT-13b · THE MAKER-CHECKER CARRIER'S STATE MACHINE (Law 5).
//
// A trust-affecting tenant setting is never written by one person (founder decision 2026-10-03: tenant maker-checker with platform
// floors, effective next midnight IST with member notice). The proposal moves:
//
//   proposed ──confirm (a DIFFERENT active tenant_admin)──▶ confirmed ──apply (the job, at/after effective_at)──▶ applied
//      │                                                       └──re-check fails at apply (floor moved)──▶ expired
//      ├──refuse (a tenant_admin, with a reason ≥ 20)──▶ refused
//      └──7 days unconfirmed (the job)──▶ expired
//
// This file is the one place those moves are written in TypeScript; 0192's `trg_tsp_moves` is the same machine in the database and
// the wall under it (maker ≠ checker, next-midnight effective_at, the floor, append-only once confirmed).
import { DomainError } from '../../../shared/errors/app-error';

export const SETTING_PROPOSAL_STATUSES = ['proposed', 'confirmed', 'refused', 'expired', 'applied'] as const;
export type SettingProposalStatus = (typeof SETTING_PROPOSAL_STATUSES)[number];

const MOVES: Readonly<Record<SettingProposalStatus, readonly SettingProposalStatus[]>> = Object.freeze({
  proposed: ['confirmed', 'refused', 'expired'],
  confirmed: ['applied', 'expired'],
  refused: [],
  expired: [],
  applied: [],
});

export class SettingProposalMoveError extends DomainError {
  constructor(from: string, to: string) { super('SETTING_PROPOSAL_CLOSED', `A setting proposal cannot move ${from} → ${to}`, 409, { from, to }); }
}

export function canMoveProposal(from: SettingProposalStatus, to: SettingProposalStatus): boolean {
  return MOVES[from]?.includes(to) ?? false;
}
export function assertProposalMove(from: SettingProposalStatus, to: SettingProposalStatus): void {
  if (!canMoveProposal(from, to)) throw new SettingProposalMoveError(from, to);
}
/** A live proposal blocks a second one on the same key (0192 `uq_tsp_live`). */
export function isLiveProposal(s: SettingProposalStatus): boolean { return s === 'proposed' || s === 'confirmed'; }
