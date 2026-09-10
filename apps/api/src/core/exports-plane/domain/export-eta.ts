// core/exports-plane/domain/export-eta.ts · W2553's *"queued with a position and ETA"*, as arithmetic that admits what
// it does not know (PC-56 TENANT-6e-2).
//
// POSITION is a FACT: how many queued jobs are ahead of this one in the worker's own FIFO (`queued_at, id`), across
// every tenant, because the queue is one queue. It is computed live at read time and never stored — a stored position is
// wrong the moment the job ahead finishes.
//
// ETA is an ESTIMATE and is labelled one: the observed median runtime of the last N jobs that reached `ready`, multiplied
// by the number of runs the worker must complete before this one is done — the jobs ahead AND this job itself, because
// a job with nothing ahead of it still has to be made. It is `null` when there is no history, because a platform that
// has never finished an export does not know how long one takes, and printing 0 would tell a secretary the file is
// ready when it is not. Unknown is not zero.
//
// WHY THE MEDIAN AND NOT THE MEAN. One district union's 400,000-row export must not make a village society's ten-row
// file look like a two-minute wait. The median is what a typical job took; the page says "estimate" beside it anyway.

/** How many finished jobs the median is taken over. Small, bounded (a partial index serves it), and recent — a queue
 *  whose worker was upgraded yesterday should not be estimated from last quarter. */
export const ETA_SAMPLE_SIZE = 20;

export interface QueueObservation {
  /** Queued jobs ahead of this one in FIFO order. */
  ahead: number;
  /** How many ready jobs the runtime sample holds — 0 means no history. */
  sample: number;
  /** Median of `generated_at - started_at` over the sample, in milliseconds. `null` when `sample` is 0. */
  medianRunMs: number | null;
}

export type Eta =
  /** *"no estimate yet"* — the honest state until the first export has ever finished. */
  | { kind: 'no_history' }
  | { kind: 'estimate'; seconds: number; basis: 'median_of_recent_runs'; sample: number; runsIncluded: number };

export interface QueueStanding {
  /** 1-based: `1` means "next to be made". W2553 says "position", and a position of zero is a number nobody says. */
  position: number;
  ahead: number;
  eta: Eta;
}

/** Median of a small list of durations — the same statistic the SQL takes, kept here so a unit test can pin the two
 *  agreeing on the even-count case (the mean of the two middle values, which is what `percentile_cont(0.5)` does). */
export function medianMs(runsMs: readonly number[]): number | null {
  const xs = runsMs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function queueStanding(obs: QueueObservation): QueueStanding {
  const ahead = Math.max(0, Math.trunc(obs.ahead));
  const position = ahead + 1;
  if (obs.sample <= 0 || obs.medianRunMs === null || !Number.isFinite(obs.medianRunMs)) {
    return { position, ahead, eta: { kind: 'no_history' } };
  }
  // Runs the worker completes before this file exists: everything ahead, then this one.
  const runsIncluded = ahead + 1;
  // Ceil, never round: an estimate that says 4 seconds for a 4.4-second wait is the estimate somebody refreshes on.
  const seconds = Math.ceil((runsIncluded * obs.medianRunMs) / 1000);
  return { position, ahead, eta: { kind: 'estimate', seconds, basis: 'median_of_recent_runs', sample: obs.sample, runsIncluded } };
}
