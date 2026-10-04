// modules/logistics/domain/route-run.state.ts · PC-56 TENANT-SW-e — THE Village Run state machine (Law 5: transitions live here).
// draft → confirmed (a SECOND person — 0201's trg_rr_moves is the wall: RUN_CHECKER_IS_DRAFTER) → loading → in_transit → completed;
// draft | confirmed | loading → cancelled (reason ≥ 10). The plan is editable only while draft.
export const RUN_STATUSES = ['draft', 'confirmed', 'loading', 'in_transit', 'completed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_ACTS = ['confirm', 'start_loading', 'depart', 'complete', 'cancel'] as const;
export type RunAct = (typeof RUN_ACTS)[number];

const MOVES: Record<RunAct, { from: readonly RunStatus[]; to: RunStatus }> = {
  confirm: { from: ['draft'], to: 'confirmed' },
  start_loading: { from: ['confirmed'], to: 'loading' },
  depart: { from: ['loading'], to: 'in_transit' },
  complete: { from: ['in_transit'], to: 'completed' },
  cancel: { from: ['draft', 'confirmed', 'loading'], to: 'cancelled' },
};

/** The status an act moves a run to, or null when the act does not apply to that status. */
export function runMove(status: RunStatus, act: RunAct): RunStatus | null {
  const m = MOVES[act];
  return m && m.from.includes(status) ? m.to : null;
}

/** The acts a run offers this viewer. Confirm is never offered to the person who drafted it (the database refuses it anyway). */
export function runActsFor(status: RunStatus, viewer: { isDrafter: boolean }): RunAct[] {
  return RUN_ACTS.filter((a) => runMove(status, a) !== null && !(a === 'confirm' && viewer.isDrafter));
}

export const isRunAct = (v: unknown): v is RunAct => typeof v === 'string' && (RUN_ACTS as readonly string[]).includes(v);
export const RUN_REASON_MIN = 10;
