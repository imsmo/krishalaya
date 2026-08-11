// core/resilience/__tests__/admin11c-circuit-observer.spec.ts · PC-56 ADMIN-11c.
//
// W007 draws a Circuit column and nothing outside this process could see one: `CircuitBreaker` keeps its state in a
// field, in memory, in apps/api, while the console reads admin-api. These tests hold down the three properties that make
// the published transitions trustworthy — and the one that makes them safe.
import { CircuitBreaker } from '../circuit-breaker';
import { CircuitTransition, instanceId, NULL_CIRCUIT_OBSERVER } from '../circuit-observer';
import { CircuitOpenError } from '../resilience.errors';

function harness(over: Partial<{ failureThreshold: number; resetMs: number; halfOpenMax: number }> = {}) {
  const seen: CircuitTransition[] = [];
  let now = 1_000_000;
  const breaker = new CircuitBreaker('msg91', {
    failureThreshold: 2, resetMs: 10_000, halfOpenMax: 1, now: () => now,
    observer: { onTransition: (t) => seen.push(t) },
    ...over,
  });
  return { breaker, seen, advance: (ms: number) => { now += ms; } };
}

const fail = () => Promise.reject(new Error('provider down'));
const ok = () => Promise.resolve('fine');

describe('ADMIN-11c · transitions are published so another process can see them', () => {
  it('publishes closed → open with the consecutive-failure count', async () => {
    const { breaker, seen } = harness();
    await expect(breaker.exec(fail)).rejects.toThrow('provider down');
    // One failure below the threshold: still closed, and NOTHING published — a state that did not change is not news.
    expect(seen).toEqual([]);
    await expect(breaker.exec(fail)).rejects.toThrow('provider down');
    expect(seen).toEqual([{ dep: 'msg91', from: 'closed', to: 'open', consecutiveFailures: 2 }]);
  });

  // W007's alert text is "razorpay circuit open after 12 consecutive 5xx" — a count at the moment of the transition,
  // which is what makes the row an explanation rather than a status.
  it('carries the count that explains WHY it opened', async () => {
    const { breaker, seen } = harness({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) await expect(breaker.exec(fail)).rejects.toThrow();
    expect(seen[0].consecutiveFailures).toBe(3);
  });

  // **A HEALTHY DEPENDENCY MUST NOT WRITE A ROW PER CALL.** Every success calls `onSuccess`, so publishing
  // 'closed → closed' would put a database write on the hot path of every outbound call — the exact cost this design
  // exists to avoid.
  it('publishes nothing at all while a dependency is healthy', async () => {
    const { breaker, seen } = harness();
    for (let i = 0; i < 50; i++) await breaker.exec(ok);
    expect(seen).toEqual([]);
  });

  it('publishes the half-open probe, because recovering is not the same as open', async () => {
    const { breaker, seen, advance } = harness();
    await expect(breaker.exec(fail)).rejects.toThrow();
    await expect(breaker.exec(fail)).rejects.toThrow();
    // Still inside the reset window: fails fast, and publishes nothing new — it is already open.
    await expect(breaker.exec(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(seen).toHaveLength(1);
    advance(10_001);
    await breaker.exec(ok);
    // open → half_open (the probe window) and then half_open → closed (the probe succeeded). An operator watching a
    // recovery needs both.
    expect(seen.map((t) => `${t.from}>${t.to}`)).toEqual(['closed>open', 'open>half_open', 'half_open>closed']);
  });

  it('publishes the re-open when a probe fails', async () => {
    const { breaker, seen, advance } = harness();
    await expect(breaker.exec(fail)).rejects.toThrow();
    await expect(breaker.exec(fail)).rejects.toThrow();
    advance(10_001);
    await expect(breaker.exec(fail)).rejects.toThrow();
    expect(seen.map((t) => `${t.from}>${t.to}`)).toEqual(['closed>open', 'open>half_open', 'half_open>open']);
  });
});

describe('ADMIN-11c · the observer cannot break the breaker', () => {
  // **THIS RUNS WHEN A DEPENDENCY HAS JUST FAILED REPEATEDLY.** If reporting the failure could throw, the platform's
  // answer to "Razorpay is down" would be "and now everything else is too". Law 12 applies most sharply to the
  // observability of an outage — and this is the deliberate opposite of ADMIN-9b, where an unloggable impersonation
  // action FAILS the request, because there the log IS the control and here the breaker is.
  it('keeps working when the sink throws', async () => {
    let calls = 0;
    const breaker = new CircuitBreaker('razorpay', {
      failureThreshold: 1, resetMs: 1_000, halfOpenMax: 1,
      observer: { onTransition: () => { calls++; throw new Error('database unreachable'); } },
    });
    // The ORIGINAL error surfaces — not the sink's. A caller must never be told the database is unreachable when what
    // happened is that the payment gateway timed out.
    await expect(breaker.exec(fail)).rejects.toThrow('provider down');
    expect(calls).toBe(1);
    // And the breaker still opened: its state machine is unaffected by the sink's failure.
    await expect(breaker.exec(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('works with no observer at all', async () => {
    // A breaker built in a test or a script must not need a sink, and the null observer makes that a decision rather
    // than an undefined call.
    const breaker = new CircuitBreaker('opensearch', { failureThreshold: 1, resetMs: 1_000, halfOpenMax: 1 });
    await expect(breaker.exec(fail)).rejects.toThrow('provider down');
    expect(() => NULL_CIRCUIT_OBSERVER.onTransition({ dep: 'x', from: 'closed', to: 'open', consecutiveFailures: 1 })).not.toThrow();
  });
});

describe('ADMIN-11c · which pod said so', () => {
  // Without an instance id the console aggregates every pod into one timeline and shows "open, closed, open" for a
  // breaker that was steadily open on one pod and steadily closed on seven — which reads as flapping and is not.
  it('prefers the orchestrator’s own identity and always resolves to something', () => {
    expect(instanceId({ POD_NAME: 'kv-api-7d9f-abcde' })).toBe('kv-api-7d9f-abcde');
    expect(instanceId({ HOSTNAME: 'ip-10-0-3-44' })).toBe('ip-10-0-3-44');
    expect(instanceId({})).toBe('unknown');
  });

  it('truncates to the column width rather than failing at insert', () => {
    expect(instanceId({ POD_NAME: 'x'.repeat(200) })).toHaveLength(80);
  });
});
