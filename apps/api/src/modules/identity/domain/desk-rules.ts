// modules/identity/domain/desk-rules.ts · PC-56 TENANT-13b · F-18 — DESKS: THE PROPOSAL MACHINE, THE DIFF, WHAT A DESK MAY CARRY, AND
// THE SEASON THE LABOUR SUGGESTION COUNTS IN. Pure: no I/O, no clock of its own.
//
// Founder decision 2026-10-03: TENANT DESK BUNDLES, NO NEW GLOBAL ROLES, NO SEPARATE OWNER ROLE. Canon W185: "Assign desks, not
// permission lists … editing a desk re-grants everyone on it, with a diff preview and checker".
//   • creating a desk, editing its PERMISSIONS, disabling / enabling it, installing the templates → a PROPOSAL a DIFFERENT active
//     tenant_admin confirms (0192 `trg_dcp_moves` is the wall; the change is applied in the confirming transaction);
//   • adding / removing a MEMBER → a direct act by a desk.manage holder, audited;
//   • a desk never carries a code on the one ungrantable list (core/rbac/ungrantable.ts) and only codes the tenant's administrators
//     themselves hold (the override path's "cannot grant what you do not hold", at the role level);
//   • a disabled desk grants nothing (the resolver joins `status = 'active'`).
import { DomainError } from '../../../shared/errors/app-error';
import { isUngrantable } from '../../../core/rbac/ungrantable';

export const DESK_PROPOSAL_KINDS = ['create', 'edit', 'disable', 'enable', 'install_templates'] as const;
export type DeskProposalKind = (typeof DESK_PROPOSAL_KINDS)[number];
export const DESK_PROPOSAL_STATUSES = ['proposed', 'confirmed', 'refused', 'expired'] as const;
export type DeskProposalStatus = (typeof DESK_PROPOSAL_STATUSES)[number];

const MOVES: Readonly<Record<DeskProposalStatus, readonly DeskProposalStatus[]>> = Object.freeze({
  proposed: ['confirmed', 'refused', 'expired'], confirmed: [], refused: [], expired: [],
});
export class DeskProposalMoveError extends DomainError {
  constructor(from: string, to: string) { super('DESK_PROPOSAL_CLOSED', `A desk proposal cannot move ${from} → ${to}`, 409, { from, to }); }
}
export function assertDeskProposalMove(from: DeskProposalStatus, to: DeskProposalStatus): void {
  if (!(MOVES[from] ?? []).includes(to)) throw new DeskProposalMoveError(from, to);
}

export const DESK_CODE = /^[a-z][a-z0-9_]{1,39}$/;
export const DESK_REASON_MIN = 20;
export const DESK_REASON_MAX = 500;
export const MEMBER_REASON_MIN = 3;
export const MEMBER_REASON_MAX = 300;
export const MAX_DESK_PERMISSIONS = 40;
export const MAX_DESK_MEMBERS = 200;

export type CodeVerdict = 'grantable' | 'ungrantable' | 'not_held' | 'unknown';
/**
 * Whether a code may sit on a desk. `adminCodes` = what the tenant_admin role holds (role_permissions); `known` = `permissions`.
 * Order matters: an ungrantable code is named as such even when the admins hold it (payout.approve).
 */
export function codeVerdict(code: string, adminCodes: ReadonlySet<string>, known: ReadonlySet<string>): CodeVerdict {
  if (!known.has(code)) return 'unknown';
  if (isUngrantable(code)) return 'ungrantable';
  if (!adminCodes.has(code)) return 'not_held';
  return 'grantable';
}

export interface DeskDiff {
  add: string[]; remove: string[];
  members: { add: string[]; remove: string[] };
}
/** The diff the review shows and the proposal stores: before → after, sorted, no overlaps. */
export function permissionDiff(before: readonly string[], after: readonly string[]): { add: string[]; remove: string[] } {
  const b = new Set(before); const a = new Set(after);
  return { add: [...a].filter((c) => !b.has(c)).sort(), remove: [...b].filter((c) => !a.has(c)).sort() };
}

export type ReasonProblem = 'required' | 'too_short' | 'too_long';
export function reasonProblem(reason: string | null | undefined, min = DESK_REASON_MIN, max = DESK_REASON_MAX): ReasonProblem | null {
  const s = (reason ?? '').trim();
  if (!s) return 'required';
  if (s.length < min) return 'too_short';
  if (s.length > max) return 'too_long';
  return null;
}

/**
 * THE SEASON the labour suggestion counts in (W185 "327 bookings this season handled by admin"). India's three cropping seasons, in
 * Asia/Kolkata: kharif 1 Jun – 31 Oct, rabi 1 Nov – 31 Mar (crossing the year), zaid 1 Apr – 31 May — the same three the crop
 * calendar CHECK names (0061: kharif | rabi | zaid | perennial). Returns the half-open UTC window [from, to).
 */
export function seasonWindow(now: Date): { season: 'kharif' | 'rabi' | 'zaid'; from: Date; to: Date } {
  const IST = (5 * 60 + 30) * 60_000;
  const local = new Date(now.getTime() + IST);
  const y = local.getUTCFullYear(); const m = local.getUTCMonth(); // 0 = Jan
  const at = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1) - IST);   // 00:00 IST on the 1st
  if (m >= 5 && m <= 9) return { season: 'kharif', from: at(y, 5), to: at(y, 10) };
  if (m >= 3 && m <= 4) return { season: 'zaid', from: at(y, 3), to: at(y, 5) };
  if (m >= 10) return { season: 'rabi', from: at(y, 10), to: at(y + 1, 3) };
  return { season: 'rabi', from: at(y - 1, 10), to: at(y, 3) };
}

/** The one desk-template code a template install proposal carries, with its codes (already filtered to grantable). */
export interface InstallItem { code: string; name: string; templateCode: string; permissions: string[] }
