// PC-51 · backpressure unit spec. Pins the README contract: critical never shed before the hard cap;
// sheddable sheds FIRST; release idempotent; env config clamped sane.
import { classify, ConcurrencyLimiter, configFromEnv, DEFAULTS } from '../backpressure';

describe('classify', () => {
  it('money/auth/trust = critical; sheddable GETs shed; their writes stay normal', () => {
    expect(classify('/v1/payments/intents', 'POST')).toBe('critical');
    expect(classify('/v1/wallet', 'GET')).toBe('critical');
    expect(classify('/v1/auctions/a1/bids', 'POST')).toBe('critical');
    expect(classify('/v1/orders/o1/confirm', 'POST')).toBe('critical');
    expect(classify('/v1/search?q=tomato', 'GET')).toBe('sheddable');
    expect(classify('/v1/market-intel/prices', 'GET')).toBe('sheddable');
    expect(classify('/v1/tenancy/analytics', 'GET')).toBe('sheddable');
    expect(classify('/v1/education/courses', 'POST')).toBe('normal'); // a write is never sheddable-by-class
    expect(classify('/v1/listings', 'GET')).toBe('normal');
  });
});

describe('ConcurrencyLimiter (degrade, never die)', () => {
  const cfg = { maxInFlight: 4, sheddableWatermark: 2, normalWatermark: 3, retryAfterSec: 7 };
  it('sheds sheddable first, then normal, and critical only at the hard cap — with Retry-After', () => {
    const l = new ConcurrencyLimiter(cfg);
    const held = [l.tryAcquire('normal'), l.tryAcquire('normal')];
    expect(held.every((r) => r.ok)).toBe(true);           // inFlight=2
    expect(l.tryAcquire('sheddable').ok).toBe(false);     // sheddable watermark hit
    expect(l.tryAcquire('normal').ok).toBe(true);         // inFlight=3
    expect(l.tryAcquire('normal').ok).toBe(false);        // normal watermark hit
    const crit = l.tryAcquire('critical');
    expect(crit.ok).toBe(true);                           // critical rides to the hard cap (4)
    const overCap = l.tryAcquire('critical');
    expect(overCap.ok).toBe(false);                       // absolute memory-protection cap
    if (!overCap.ok) expect(overCap.retryAfterSec).toBe(7);
    expect(l.shed.sheddable).toBe(1); expect(l.shed.normal).toBe(1); expect(l.shed.critical).toBe(1);
  });
  it('release is idempotent — a double release never corrupts the in-flight count', () => {
    const l = new ConcurrencyLimiter(cfg);
    const r = l.tryAcquire('normal');
    expect(r.ok).toBe(true);
    if (r.ok) { r.release(); r.release(); }
    expect(l.current).toBe(0);
  });
});

describe('configFromEnv', () => {
  it('reads BP_* and clamps watermarks under the hard cap; garbage falls back to defaults', () => {
    expect(configFromEnv({})).toEqual(DEFAULTS);
    const c = configFromEnv({ BP_MAX_INFLIGHT: '100', BP_NORMAL_WATERMARK: '500', BP_SHEDDABLE_WATERMARK: '90', BP_RETRY_AFTER_SEC: 'abc' });
    expect(c).toEqual({ maxInFlight: 100, normalWatermark: 100, sheddableWatermark: 90, retryAfterSec: DEFAULTS.retryAfterSec });
  });
});
