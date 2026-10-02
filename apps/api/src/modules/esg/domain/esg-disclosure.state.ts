// modules/esg/domain/esg-disclosure.state.ts · PC-56 TENANT-9d · THE DISCLOSURE'S STATE MACHINE, in one place (Law 5).
// 0183's `trg_esg_disclosures_guard` is the other half — the same moves, for every role, owner included:
//   draft → published (the words fixed as reviewed) · draft | published → withdrawn (with a declared reason) · final is final.
export const DISCLOSURE_ACTS = ['publish', 'withdraw'] as const;
export type DisclosureAct = (typeof DISCLOSURE_ACTS)[number];

export const DISCLOSURE_TRANSITIONS: Record<DisclosureAct, { from: readonly string[]; to: 'published' | 'withdrawn' }> = {
  publish: { from: ['draft'], to: 'published' },
  withdraw: { from: ['draft', 'published'], to: 'withdrawn' },
};

export const isDisclosureAct = (a: unknown): a is DisclosureAct => typeof a === 'string' && (DISCLOSURE_ACTS as readonly string[]).includes(a);
export function canTransition(act: DisclosureAct, status: string): boolean { return DISCLOSURE_TRANSITIONS[act].from.includes(status); }
/** The acts a disclosure in this status offers (the dashboard's links). */
export function actsFor(status: string): DisclosureAct[] { return DISCLOSURE_ACTS.filter((a) => canTransition(a, status)); }
