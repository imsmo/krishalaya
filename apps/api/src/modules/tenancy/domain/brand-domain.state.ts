// modules/tenancy/domain/brand-domain.state.ts · PC-56 TENANT-13d · THE STATE MACHINES OF W191 / W192 (Law 5 — one place in TypeScript).
//
// BRAND PROPOSAL (publish | rollback)            0194 `trg_tbp_moves` is the same machine in the database and the wall under it.
//   proposed ──confirm (a DIFFERENT active tenant_admin; same tx publishes)──▶ confirmed
//      ├──refuse / withdraw (a tenant_admin, with a reason)──▶ refused
//      └──7 days unconfirmed (the clock job)──▶ expired
//
// BRAND (tenant_branding.status)
//   draft ──(confirmed proposal publishes the working copy)──▶ published ──(any edit of the working copy)──▶ draft
//
// DOMAIN CLAIM (tenant_domains.verification_status, kind custom)      0194 `trg_tenant_domains_gate`.
//   pending ──DNS proves CNAME + TXT──▶ verified           (the verifier only; never a fake verified)
//      │  └──DNS check fails──▶ failed ──(next check proves it)──▶ verified
//      └──(pending | failed) past 7 days──▶ expired (released: soft-deleted, the name free again)
//   The included subdomain is born verified and stays verified.
//
// DOMAIN PROPOSAL (make_primary | remove)       0194 `trg_tdp_moves`.
//   proposed ──confirm (a DIFFERENT active tenant_admin; same tx applies)──▶ confirmed;  ──refuse──▶ refused;  ──7 days──▶ expired
import { DomainError } from '../../../shared/errors/app-error';

export const BRAND_PROPOSAL_STATUSES = ['proposed', 'confirmed', 'refused', 'expired'] as const;
export type BrandProposalStatus = (typeof BRAND_PROPOSAL_STATUSES)[number];
export const DOMAIN_PROPOSAL_STATUSES = BRAND_PROPOSAL_STATUSES;
export type DomainProposalStatus = BrandProposalStatus;
export type ClaimStatus = 'pending' | 'verified' | 'failed' | 'expired';

const PROPOSAL_MOVES: Readonly<Record<BrandProposalStatus, readonly BrandProposalStatus[]>> = Object.freeze({
  proposed: ['confirmed', 'refused', 'expired'], confirmed: [], refused: [], expired: [],
});
const CLAIM_MOVES: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = Object.freeze({
  pending: ['verified', 'failed', 'expired'], failed: ['verified', 'failed', 'expired'], verified: [], expired: [],
});

export class ProposalMoveError extends DomainError {
  constructor(what: string, from: string, to: string) { super('PROPOSAL_CLOSED', `A ${what} proposal cannot move ${from} → ${to}`, 409, { from, to }); }
}
export class ClaimMoveError extends DomainError {
  constructor(from: string, to: string) { super('DOMAIN_CLAIM_CLOSED', `A domain claim cannot move ${from} → ${to}`, 409, { from, to }); }
}

export function canMoveProposal(from: BrandProposalStatus, to: BrandProposalStatus): boolean { return PROPOSAL_MOVES[from]?.includes(to) ?? false; }
export function assertBrandProposalMove(from: BrandProposalStatus, to: BrandProposalStatus): void {
  if (!canMoveProposal(from, to)) throw new ProposalMoveError('brand', from, to);
}
export function assertDomainProposalMove(from: DomainProposalStatus, to: DomainProposalStatus): void {
  if (!canMoveProposal(from, to)) throw new ProposalMoveError('domain', from, to);
}
export function canMoveClaim(from: ClaimStatus, to: ClaimStatus): boolean { return CLAIM_MOVES[from]?.includes(to) ?? false; }
export function assertClaimMove(from: ClaimStatus, to: ClaimStatus): void { if (!canMoveClaim(from, to)) throw new ClaimMoveError(from, to); }
/** The brand's status after a working-copy edit: an edit always returns it to draft (members still see the published version). */
export function brandStatusAfterEdit(): 'draft' { return 'draft'; }
