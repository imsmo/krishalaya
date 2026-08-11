// core/resilience/circuit-breaker.ts · one breaker per external dependency (razorpay, razorpayx,
// wallet, msg91, opensearch…). Stops hammering a dead dependency: after `failureThreshold`
// consecutive failures it OPENs (fail fast with CircuitOpenError) for `resetMs`, then allows a
// limited HALF-OPEN trial; a success closes it, a failure re-opens it.
import { CircuitOpenError } from './resilience.errors';
import { CircuitObserver, NULL_CIRCUIT_OBSERVER } from './circuit-observer';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitOptions {
  failureThreshold: number; resetMs: number; halfOpenMax: number; now?: () => number;
  /** PC-56 ADMIN-11c: where transitions are published so a process OTHER than this one can see them (W007's Circuit
   *  column). Optional, and a no-op by default — a breaker constructed in a test or a script must not need a database. */
  observer?: CircuitObserver;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;
  private readonly now: () => number;
  private readonly observer: CircuitObserver;

  constructor(private readonly dep: string, private readonly opts: CircuitOptions) {
    this.now = opts.now ?? Date.now;
    this.observer = opts.observer ?? NULL_CIRCUIT_OBSERVER;
  }

  get currentState(): CircuitState { return this.state; }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.now() - this.openedAt < this.opts.resetMs) throw new CircuitOpenError(this.dep);
      this.transition('half_open');             // probe window — published, because a half-open breaker is what an
      this.halfOpenInFlight = 0;                // operator sees as "recovering" and needs to distinguish from "open"

    }
    if (this.state === 'half_open' && this.halfOpenInFlight >= this.opts.halfOpenMax) {
      throw new CircuitOpenError(this.dep);     // cap concurrent trials
    }
    if (this.state === 'half_open') this.halfOpenInFlight++;
    try {
      const r = await fn();
      this.onSuccess();
      return r;
    } catch (err) {
      this.onFailure();
      throw err;
    } finally {
      if (this.state === 'half_open' && this.halfOpenInFlight > 0) this.halfOpenInFlight--;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.transition('closed');
  }
  private onFailure(): void {
    this.failures++;
    if (this.state === 'half_open' || this.failures >= this.opts.failureThreshold) {
      this.openedAt = this.now();
      this.transition('open');
    }
  }

  /**
   * The ONLY place `state` is assigned, so no transition can be added later that forgets to publish itself — the
   * property ADMIN-11's flag targeting lost by having two code paths for one rule.
   *
   * **A NO-OP TRANSITION IS NOT PUBLISHED.** Every successful call calls `onSuccess`, so publishing 'closed → closed'
   * would put a row on the hot path of every healthy dependency call — the exact write this design exists to avoid.
   *
   * **AND THE OBSERVER CANNOT BREAK THE BREAKER.** This runs when a dependency has just failed repeatedly; if reporting
   * the failure could throw, the platform's answer to "Razorpay is down" would be "and now everything else is too".
   */
  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    try {
      this.observer.onTransition({ dep: this.dep, from, to, consecutiveFailures: this.failures });
    } catch { /* the breaker is the control; the log is the report (Law 12) */ }
  }
}
