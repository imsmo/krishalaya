// core/resilience/resilience.service.ts
// THE single entry point for calling an external dependency (Law 12: degrade, never die).
// Composition (outer→inner): bulkhead → circuit-breaker → retry → timeout. The bulkhead bounds
// concurrency so one slow dep can't drown the process; the breaker stops hammering a dead dep;
// retry (idempotent only) rides out blips; the timeout guarantees no unbounded wait. A failure
// AFTER retries trips the breaker. Per-dependency breakers/bulkheads are isolated.
//
// SAFETY: a money operation (`money: true`) may NOT declare a fallback and is NOT auto-retried
// unless the caller passes an idempotency-safe `retries` explicitly — a non-idempotent debit must
// fail loudly, never silently "succeed" via a fallback or be blindly re-sent.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics } from '../observability/metrics';
import { CircuitBreaker, CircuitOptions } from './circuit-breaker';
import { Bulkhead, BulkheadOptions } from './bulkhead';
import { withTimeout } from './timeout';
import { withRetry } from './retry';
import { withFallback, Fallback } from './fallback.registry';
import { CircuitObserver, NULL_CIRCUIT_OBSERVER } from './circuit-observer';

export const RESILIENCE = Symbol('RESILIENCE');

export interface DepPolicy { timeoutMs: number; retries: number; baseMs: number; maxMs: number; circuit: CircuitOptions; bulkhead: BulkheadOptions; }

const DEFAULT: DepPolicy = {
  timeoutMs: 5000, retries: 2, baseMs: 50, maxMs: 1000,
  circuit: { failureThreshold: 5, resetMs: 10_000, halfOpenMax: 2 },
  bulkhead: { maxConcurrent: 32, maxQueue: 128 },
};

export interface RunOptions<T> {
  /** Retry override (default policy.retries). Set 0 for non-idempotent calls. */
  retries?: number;
  /** Degrade instead of fail. FORBIDDEN when money:true. */
  fallback?: Fallback<T>;
  /** Marks a money/ledger/payout call: forbids fallback; defaults retries to 0 unless overridden. */
  money?: boolean;
  /** Decide which errors are retryable (default: InfraError-flagged). */
  retryable?: (err: unknown) => boolean;
}

@Injectable()
export class ResilienceService {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly bulkheads = new Map<string, Bulkhead>();
  private readonly policies = new Map<string, DepPolicy>();

  /** PC-56 ADMIN-11c: where breaker transitions are published so admin-api can answer W007's Circuit column. Optional
   *  in the constructor so every existing test that builds a ResilienceService with just metrics keeps compiling — and
   *  so a missing sink degrades to "no console visibility" rather than to a boot failure. */
  private observer: CircuitObserver = NULL_CIRCUIT_OBSERVER;

  constructor(@Inject(METRICS) private readonly metrics: Metrics) {}

  /** Install the transition sink. Called once at module init; breakers created before it keep the null observer, which
   *  is why `core.module.ts` installs it before anything can make a call. */
  useCircuitObserver(observer: CircuitObserver): void { this.observer = observer; }

  /** Register/override a dependency's policy (call once at module init; otherwise DEFAULT applies). */
  configure(dep: string, policy: Partial<DepPolicy>): void {
    this.policies.set(dep, { ...DEFAULT, ...policy });
  }

  async run<T>(dep: string, fn: () => Promise<T>, opts: RunOptions<T> = {}): Promise<T> {
    if (opts.money && opts.fallback) throw new Error(`resilience: money call '${dep}' must not have a fallback`);
    const p = this.policies.get(dep) ?? DEFAULT;
    const breaker = this.breaker(dep, p.circuit);
    const bulkhead = this.bulkhead(dep, p.bulkhead);
    const retries = opts.retries ?? (opts.money ? 0 : p.retries);

    const core = () => bulkhead.exec(() => breaker.exec(() =>
      withRetry(() => withTimeout(dep, p.timeoutMs, fn), { retries, baseMs: p.baseMs, maxMs: p.maxMs, retryable: opts.retryable })));

    const guarded = async (): Promise<T> => {
      const t0 = Date.now();
      try {
        const r = await core();
        this.metrics.observe('dep.call', Date.now() - t0, { dep, ok: 'true' });
        return r;
      } catch (err) {
        this.metrics.observe('dep.call', Date.now() - t0, { dep, ok: 'false' });
        this.metrics.inc('dep.failure', { dep, state: breaker.currentState });
        throw err;
      }
    };

    return opts.fallback ? withFallback(guarded, opts.fallback) : guarded();
  }

  /** Inspect breaker state (health endpoints / tests). */
  stateOf(dep: string): string { return this.breakers.get(dep)?.currentState ?? 'closed'; }

  private breaker(dep: string, c: CircuitOptions): CircuitBreaker {
    let b = this.breakers.get(dep);
    if (!b) { b = new CircuitBreaker(dep, { ...c, observer: this.observer }); this.breakers.set(dep, b); }
    return b;
  }
  private bulkhead(dep: string, c: BulkheadOptions): Bulkhead {
    let b = this.bulkheads.get(dep);
    if (!b) { b = new Bulkhead(dep, c); this.bulkheads.set(dep, b); }
    return b;
  }
}
