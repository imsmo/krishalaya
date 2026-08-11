// core/resilience/circuit-observer.ts · PC-56 ADMIN-11c.
//
// **W007 SHOWS A CIRCUIT COLUMN AND NOTHING OUTSIDE THIS PROCESS CAN SEE ONE.** `CircuitBreaker` keeps its state in a
// field, in memory, in apps/api. The console reads admin-api — a different process, a different pool — so the column
// could not be filled even with a single pod, and at this platform's target scale there are many. `msg91 half-open` is
// one pod's opinion about one dependency.
//
// **SO THIS DOES NOT PUBLISH A GAUGE, IT PUBLISHES TRANSITIONS.** A breaker changes state rarely by construction — that
// is what a failure threshold is for — so a row per transition per instance is not a hot-path write. And a transition is
// what an operator actually needs: W007's own alert text is "msg91 degraded since 13:40 IST" and "razorpay circuit open
// after 12 consecutive 5xx", which is a time and a count, not a gauge.
//
// **THE RECORDER IS BEST-EFFORT AND NEVER THROWS — deliberately, and it is the one place in this wave where that is the
// right call.** This code runs at the moment a dependency has just failed repeatedly. If recording the failure could
// itself fail the request, then the platform's response to "Razorpay is down" would be "and now everything else is too".
// Law 12 (degrade, never die) applies to observability of an outage more sharply than to anything else. It is the
// opposite of the ADMIN-9b rule where an unloggable impersonation action FAILS the request — and the difference is that
// there, the log IS the control; here, the breaker is the control and the log is the report.

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitTransition {
  dep: string;
  from: CircuitState;
  to: CircuitState;
  /** Consecutive failures at the moment of the transition. W007's "after 12 consecutive 5xx" — a count, not a rate. */
  consecutiveFailures: number;
}

/** What a transition sink must implement. Named as a port so the breaker never learns about a database. */
export interface CircuitObserver {
  onTransition(t: CircuitTransition): void;
}

export const CIRCUIT_OBSERVER = Symbol('CIRCUIT_OBSERVER');

/**
 * The instance identity that makes a distributed circuit legible. Without it the console would aggregate transitions
 * from every pod into one timeline and show "open, then closed, then open" for a breaker that was steadily open on one
 * pod and steadily closed on seven — which reads as flapping and is not.
 *
 * Resolution order is the deployment's own: Kubernetes injects `POD_NAME`, ECS gives a task id, and the hostname is the
 * fallback that always exists. Truncated to the column width rather than left to error at insert.
 */
export function instanceId(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.POD_NAME || env.HOSTNAME || env.ECS_TASK_ID || 'unknown';
  return raw.slice(0, 80);
}

/** A no-op observer. Used where a breaker is constructed outside the DI graph (tests, scripts) so the absence of a sink
 *  is a decision rather than an undefined call. */
export const NULL_CIRCUIT_OBSERVER: CircuitObserver = { onTransition: () => undefined };
