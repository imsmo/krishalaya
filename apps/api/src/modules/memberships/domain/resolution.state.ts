// modules/memberships/domain/resolution.state.ts · PC-56 TENANT-9b · THE RESOLUTION STATE MACHINE (Law 5: one place).
//
//   draft ──open──▶ open ──close──▶ closed      (final: the result is a fact — 0182 writes it, nothing moves it)
//     │               │
//     └──withdraw──┐  └──withdraw──▶ withdrawn  (final: nothing was decided)
//                  ▼
//              withdrawn
//
// 0182's `trg_coop_resolutions_guard` holds exactly these moves in the database for every role (owner included); this
// file is what the API asks before it tries one, so a refusal is a sentence and not a 23514. A spec asserts the two lists
// are the same moves.
export const RESOLUTION_MOVES = {
  open: { from: ['draft'], to: 'open' },
  close: { from: ['open'], to: 'closed' },
  withdraw: { from: ['draft', 'open'], to: 'withdrawn' },
} as const;
export type ResolutionMove = keyof typeof RESOLUTION_MOVES;

export const FINAL_STATUSES = ['closed', 'withdrawn'] as const;

export function canMove(act: ResolutionMove, from: string): boolean {
  return (RESOLUTION_MOVES[act].from as readonly string[]).includes(from);
}
export function targetOf(act: ResolutionMove): string { return RESOLUTION_MOVES[act].to; }
export function isFinal(status: string): boolean { return (FINAL_STATUSES as readonly string[]).includes(status); }
/** The acts a resolution in this status offers (the page draws exactly these). */
export function actsFrom(status: string): ResolutionMove[] {
  return (Object.keys(RESOLUTION_MOVES) as ResolutionMove[]).filter((a) => canMove(a, status));
}
