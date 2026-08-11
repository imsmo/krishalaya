// core/resilience/circuit-event.recorder.ts · the transition sink (PC-56 ADMIN-11c).
//
// Writes `provider_circuit_events` so a process other than this one can answer W007's Circuit column. Three properties,
// each of which is a decision rather than an implementation detail:
//
//   1. **IT NEVER THROWS AND NEVER AWAITS.** `onTransition` is called from inside `CircuitBreaker`, at the moment a
//      dependency has just failed repeatedly. It returns void, fires the insert, and swallows the result. Making the
//      breaker await a database write when an outage is in progress would put a second dependency in the failure path of
//      the first — and this is the one place in this wave where best-effort is right, because the breaker is the control
//      and this row is only the report. (Contrast ADMIN-9b, where an unloggable impersonation action FAILS the request:
//      there the log IS the control.)
//   2. **IT COALESCES.** A pod that flaps — open, half-open, open, half-open — while a provider is timing out would
//      otherwise write a row every `resetMs`. The recorder drops a transition identical to the previous one for the same
//      dependency inside a short window, so a genuinely flapping breaker produces a readable trickle rather than a
//      thousand rows an hour, and the console can still see the flapping because the coalescing window is small.
//   3. **IT RESOLVES `provider_code` FROM A DECLARED MAP CACHED ONCE**, because the alternative is a lookup query on the
//      failure path of a failing dependency.
import { Injectable, Logger } from '@nestjs/common';
import { PgPoolProvider } from '../database/pg-pool.provider';
import { CircuitObserver, CircuitTransition, instanceId } from './circuit-observer';

/** Two identical transitions for one dependency inside this window collapse to one row. Small on purpose: a breaker
 *  that opens, half-opens and re-opens three times in a minute is a fact an operator needs, not noise. */
const COALESCE_MS = 30_000;

@Injectable()
export class CircuitEventRecorder implements CircuitObserver {
  private readonly log = new Logger(CircuitEventRecorder.name);
  private readonly instance = instanceId();
  private readonly last = new Map<string, { key: string; at: number }>();
  /** Resolved once, lazily, and never re-read on a failure path. A dependency added after boot records with a NULL
   *  provider_code rather than blocking to look it up — which the console renders as the dependency's own name. */
  private depMap: Map<string, string | null> | null = null;

  constructor(private readonly pools: PgPoolProvider) {}

  onTransition(t: CircuitTransition): void {
    const key = `${t.from}>${t.to}`;
    const prev = this.last.get(t.dep);
    const now = Date.now();
    if (prev && prev.key === key && now - prev.at < COALESCE_MS) return;
    this.last.set(t.dep, { key, at: now });
    // Deliberately not awaited: see the header. `void` is the signal to a reader that the omission is intentional
    // rather than a forgotten await — the shape a lint rule and a reviewer both look for.
    void this.write(t);
  }

  private async write(t: CircuitTransition): Promise<void> {
    try {
      const providerCode = await this.providerFor(t.dep);
      await this.pools.writer(0).query(
        `INSERT INTO provider_circuit_events
           (dep, provider_code, from_state, to_state, consecutive_failures, instance_id, app)
         VALUES ($1,$2,$3,$4,$5,$6,'api')`,
        [t.dep, providerCode, t.from, t.to, t.consecutiveFailures, this.instance]);
    } catch (err) {
      // A warning and nothing else. The alternative — rethrowing into a breaker — is the failure mode described above.
      this.log.warn(`circuit transition not recorded (${t.dep} ${t.from}->${t.to}): ${(err as Error)?.message ?? err}`);
    }
  }

  private async providerFor(dep: string): Promise<string | null> {
    if (!this.depMap) {
      try {
        const r = await this.pools.replica(0).query<{ dep: string; provider_code: string | null }>(
          `SELECT dep, provider_code FROM provider_dependencies WHERE deleted_at IS NULL`);
        this.depMap = new Map(r.rows.map((x) => [x.dep, x.provider_code]));
      } catch {
        // An unreadable map must not stop the row being written: the dependency key is the important half, and
        // `provider_code` is a grouping convenience the console can live without.
        return null;
      }
    }
    return this.depMap.get(dep) ?? null;
  }
}
