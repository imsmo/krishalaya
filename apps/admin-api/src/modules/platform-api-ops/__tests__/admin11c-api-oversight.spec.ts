// modules/platform-api-ops/__tests__/admin11c-api-oversight.spec.ts · PC-56 ADMIN-11c.
//
// Four things this plane must not get wrong, and each of them was a fiction on the screen before the wave:
//   1. a circuit state is PER-PROCESS, so "open" is a count of instances and not a platform fact;
//   2. a blank Fallback column means "forbidden because money" or "undefended" — opposite readings;
//   3. a success rate over an empty window is not 100%;
//   4. our own unconfigured secret is not a provider's signature failure.
import {
  circuitStateKey, circuitStateClass, daysSince, fallbackActive, fallbackKey, fleetState, keyState, keyStateClass,
  registryStatusKey, successRateBp, successRateKey, verdictClass, verdictKey, backlogClass, payloadNoteKey,
  HOURLY_USAGE_HAS_NO_ADMIN_SOURCE, LATENCY_HAS_NO_SOURCE, TENANT_REGISTRY_HAS_NO_ISSUER, rateCellKeys,
} from '../domain/api-oversight';

const NOW = new Date('2026-08-11T12:00:00Z');

describe('ADMIN-11c · a circuit breaker is per-process', () => {
  const inst = (state: string, id = 'pod-a') => ({ instanceId: id, state, consecutiveFailures: 12, occurredAt: NOW.toISOString() });

  // **THE COLUMN W007 DRAWS COULD NOT BE FILLED FROM WHERE THE CONSOLE STANDS.** The breakers are in-memory in apps/api;
  // admin-api is a different process. With eight pods, one open breaker means an eighth of traffic is failing fast.
  it('reports the worst state across the fleet and how many instances said so', () => {
    expect(fleetState([inst('closed', 'a'), inst('open', 'b'), inst('closed', 'c')]))
      .toEqual({ state: 'open', open: 1, total: 3 });
    expect(fleetState([inst('closed', 'a'), inst('half_open', 'b')]))
      .toEqual({ state: 'half_open', open: 0, total: 2 });
    expect(fleetState([inst('closed', 'a')])).toEqual({ state: 'closed', open: 0, total: 1 });
  });

  // **SILENCE IS NOT HEALTH.** No instance reporting means either nothing has ever failed or nothing is reporting, and
  // those are opposite conclusions — the sixth time this programme has had to separate them.
  it('calls an empty fleet "unknown" and never "closed"', () => {
    expect(fleetState([])).toEqual({ state: 'unknown', open: 0, total: 0 });
    expect(circuitStateKey('unknown')).toBe('ap11.circ.unknown');
    expect(circuitStateClass('unknown')).toContain('is-warn');
    expect(circuitStateClass('closed')).toContain('is-ok');
  });

  it('treats an unrecognised state as unknown rather than as closed', () => {
    expect(circuitStateKey('tripped')).toBe('ap11.circ.unknown');
    expect(circuitStateClass('tripped')).not.toContain('is-ok');
  });

  it('draws open loudest and half-open as a warning', () => {
    expect(circuitStateClass('open')).toContain('is-danger');
    expect(circuitStateClass('half_open')).toContain('is-warn');
  });
});

describe('ADMIN-11c · a blank Fallback column means two opposite things', () => {
  // A money call has no fallback BY RULE — `ResilienceService.run` throws if one is passed with `money: true`, because a
  // failed debit must fail rather than silently "succeed". An ordinary dependency with no fallback is undefended.
  it('separates "forbidden because money" from "undefended"', () => {
    expect(fallbackKey({ fallbackStrategy: null, isMoney: true })).toBe('ap11.fb.forbidden');
    expect(fallbackKey({ fallbackStrategy: null, isMoney: false })).toBe('ap11.fb.none');
    expect(fallbackKey({ fallbackStrategy: 'voice-OTP', isMoney: false })).toBe('ap11.fb.declared');
  });

  // W007 prints "voice-OTP (active)". A fallback runs exactly when the breaker is NOT closed, which is the only honest
  // way to know it — nothing records a fallback invocation.
  it('derives whether a declared fallback is carrying traffic from the breaker state', () => {
    expect(fallbackActive({ fallbackStrategy: 'voice-OTP' }, 'open')).toBe(true);
    expect(fallbackActive({ fallbackStrategy: 'voice-OTP' }, 'half_open')).toBe(true);
    expect(fallbackActive({ fallbackStrategy: 'voice-OTP' }, 'closed')).toBe(false);
    // No declared fallback cannot be active, whatever the breaker is doing.
    expect(fallbackActive({ fallbackStrategy: null }, 'open')).toBe(false);
    // And an unknown state is not "active": a fallback we cannot show to be running must not be claimed as running.
    expect(fallbackActive({ fallbackStrategy: 'voice-OTP' }, 'unknown')).toBe(false);
  });
});

describe('ADMIN-11c · the two columns with no source', () => {
  it('names the absence rather than approximating it', () => {
    // The consecutive-failure count recorded when a breaker opens is NOT an error rate, and printing it as one would be
    // the substitution this programme has refused seven times.
    expect(LATENCY_HAS_NO_SOURCE).toBe('ap11.latency.noSource');
    expect(HOURLY_USAGE_HAS_NO_ADMIN_SOURCE).toBe('ap11.usage.noSource');
  });

  it('keeps the rate LIMIT and the rate USAGE in one place so the second cannot be rendered by accident', () => {
    const cells = rateCellKeys();
    expect(cells.limit).toBe('ap11.rate.limit');
    expect(cells.usage).toBe(HOURLY_USAGE_HAS_NO_ADMIN_SOURCE);
  });
});

describe('ADMIN-11c · two key registries, one of which nothing has ever written', () => {
  // `api_keys` has existed since migration 0002 and `grep -rn "[^_]api_keys\b" apps packages` returns nothing: no
  // issuer, no gateway, no last-used stamp, no console. `partner_api_keys` (PC-55 A10) is the live one.
  it('labels the tenant registry as having no issuer', () => {
    expect(TENANT_REGISTRY_HAS_NO_ISSUER).toBe(true);
    expect(registryStatusKey('tenant')).toBe('ap11.reg.noIssuer');
    expect(registryStatusKey('partner')).toBe('ap11.reg.live');
  });

  it('separates "never used" from "unused for 90 days"', () => {
    // Both are revocation candidates for different reasons: one is an integration that never shipped, the other is a
    // change somebody made without telling us.
    expect(keyState({ revokedAt: null, lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z' }, NOW)).toBe('never_used');
    expect(keyState({ revokedAt: null, lastUsedAt: '2026-04-04T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }, NOW)).toBe('dormant');
    expect(keyState({ revokedAt: null, lastUsedAt: '2026-08-10T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }, NOW)).toBe('active');
    expect(keyState({ revokedAt: '2026-07-12T00:00:00Z', lastUsedAt: '2026-08-10T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }, NOW)).toBe('revoked');
  });

  it('draws a never-used key as a warning, because nobody would notice it being stolen', () => {
    expect(keyStateClass('never_used')).toContain('is-warn');
    expect(keyStateClass('dormant')).toContain('is-warn');
    expect(keyStateClass('active')).toContain('is-ok');
    expect(keyStateClass('revoked')).not.toContain('is-danger');
  });

  it('floors idle days rather than rounding them', () => {
    // The ADMIN-9 dormancy rule: 89.6 days rendered as 90 makes a threshold trip a day early and is impossible to
    // explain to the operator watching it.
    expect(daysSince('2026-08-10T23:00:00Z', NOW)).toBe(0);
    expect(daysSince('2026-08-10T11:00:00Z', NOW)).toBe(1);
    // A malformed timestamp is 0, never NaN days.
    expect(daysSince('not-a-date', NOW)).toBe(0);
  });
});

describe('ADMIN-11c · outbound delivery health', () => {
  const s = (attempted: number, succeeded: number) => ({ attempted24h: attempted, succeeded24h: succeeded });

  it('computes the rate in integer basis points', () => {
    expect(successRateBp(s(1_000, 968))).toBe(9_680);
    expect(successRateBp(s(3, 2))).toBe(6_667);
  });

  // **UNKNOWN IS NOT 100%.** With nothing attempted there is no rate, and a hopeful number over an empty window is how
  // a dispatcher that has stopped looks healthy.
  it('returns null over an empty window and says so', () => {
    expect(successRateBp(s(0, 0))).toBeNull();
    expect(successRateKey(null)).toBe('ap11.deliv.noTraffic');
    expect(successRateKey(9_680)).toBe('ap11.deliv.ok');
    expect(successRateKey(9_950)).toBe('ap11.deliv.good');
    expect(successRateKey(8_000)).toBe('ap11.deliv.poor');
  });

  // A pending retry is the system working (the worker backs off, up to eight attempts). A delivery past that ceiling is
  // an event the tenant will never receive, and nothing else on this platform mentions it again.
  it('treats an exhausted delivery as worse than any backlog', () => {
    expect(backlogClass({ pendingRetry: 0, exhausted24h: 1 })).toContain('is-danger');
    expect(backlogClass({ pendingRetry: 900, exhausted24h: 0 })).toContain('is-warn');
    expect(backlogClass({ pendingRetry: 12, exhausted24h: 0 })).not.toContain('is-warn');
  });
});

describe('ADMIN-11c · the inbound verdict, which was recorded nowhere', () => {
  it('names five distinct failure reasons a boolean would collapse', () => {
    expect(verdictKey({ signatureOk: true, signatureReason: 'ok' })).toBe('ap11.sig.ok');
    expect(verdictKey({ signatureOk: false, signatureReason: 'absent' })).toBe('ap11.sig.absent');
    expect(verdictKey({ signatureOk: false, signatureReason: 'mismatch' })).toBe('ap11.sig.mismatch');
    expect(verdictKey({ signatureOk: false, signatureReason: 'unparseable' })).toBe('ap11.sig.unparseable');
    // **OUR OWN MISSING SECRET, WHICH COUNTED AS A SIGNATURE FAILURE WOULD SEND AN OPERATOR TO ROTATE A PROVIDER'S.**
    expect(verdictKey({ signatureOk: false, signatureReason: 'secret_unconfigured' })).toBe('ap11.sig.secret_unconfigured');
    expect(verdictKey({ signatureOk: false, signatureReason: null })).toBe('ap11.sig.failedUnknown');
  });

  // A receipt written and never settled: the process died mid-handling. A finding, not a neutral state.
  it('treats an unsettled receipt as a warning rather than a pass', () => {
    expect(verdictKey({ signatureOk: null, signatureReason: null })).toBe('ap11.sig.undecided');
    expect(verdictClass({ signatureOk: null, signatureReason: null })).toContain('is-warn');
    expect(verdictClass({ signatureOk: true, signatureReason: 'ok' })).toContain('is-ok');
    expect(verdictClass({ signatureOk: false, signatureReason: 'mismatch' })).toContain('is-danger');
  });

  it('says when a stored payload is only part of what arrived', () => {
    // An unauthenticated sink is an unbounded write path, so the payload is capped — and a truncated row has to admit
    // it, or a reviewer reads a 2 KB head as the whole callback.
    expect(payloadNoteKey({ truncated: true })).toBe('ap11.payload.truncated');
    expect(payloadNoteKey({ truncated: false })).toBeNull();
  });
});
