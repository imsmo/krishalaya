// core/backpressure/backpressure.ts · PC-51. At overload the platform DEGRADES, never DIES (README spec).
// Pure, dependency-free: a priority classifier + an in-flight concurrency limiter with per-class shedding.
//   critical  — money/auth/trust (payments, wallet, auth, bids, orders lifecycle): NEVER shed by class caps;
//               only the absolute hard cap (memory protection) can refuse it.
//   normal    — everything else: shed only when the global cap is exhausted.
//   sheddable — recommendations/analytics/search/insights reads: shed FIRST at the sheddable watermark.
// Shedding = synchronous 503 + Retry-After (cheap rejection is the whole point — no queue, no await).
export type PriorityClass = 'critical' | 'normal' | 'sheddable';

const CRITICAL = [/^\/?v\d+\/payments\b/, /^\/?v\d+\/auth\b/, /^\/?v\d+\/wallet/, /^\/?v\d+\/auctions\/.+\/bids/, /^\/?v\d+\/orders\b/, /^\/?v\d+\/kyc\b/, /^\/?v\d+\/health/];
const SHEDDABLE = [/^\/?v\d+\/search\b/, /^\/?v\d+\/market-intel\b/, /^\/?v\d+\/assistant\b/, /^\/?v\d+\/reviews\b(?!.*\bPOST\b)/, /^\/?v\d+\/cms\b/, /^\/?v\d+\/education\b/, /analytics/, /insights/, /recommend/];

/** Classify by path (+ method: GETs on sheddable areas shed; their WRITES are normal). */
export function classify(path: string, method = 'GET'): PriorityClass {
  const p = path.split('?')[0];
  if (CRITICAL.some((r) => r.test(p))) return 'critical';
  if (method.toUpperCase() === 'GET' && SHEDDABLE.some((r) => r.test(p))) return 'sheddable';
  return 'normal';
}

export interface BackpressureConfig {
  maxInFlight: number;        // absolute hard cap (memory protection) — applies to ALL classes
  sheddableWatermark: number; // in-flight level at which 'sheddable' starts being refused
  normalWatermark: number;    // in-flight level at which 'normal' starts being refused
  retryAfterSec: number;
}
export const DEFAULTS: BackpressureConfig = { maxInFlight: 400, sheddableWatermark: 240, normalWatermark: 360, retryAfterSec: 5 };

export function configFromEnv(env: Record<string, string | undefined>): BackpressureConfig {
  const n = (k: string, d: number) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : d; };
  const cfg = {
    maxInFlight: n('BP_MAX_INFLIGHT', DEFAULTS.maxInFlight),
    sheddableWatermark: n('BP_SHEDDABLE_WATERMARK', DEFAULTS.sheddableWatermark),
    normalWatermark: n('BP_NORMAL_WATERMARK', DEFAULTS.normalWatermark),
    retryAfterSec: n('BP_RETRY_AFTER_SEC', DEFAULTS.retryAfterSec),
  };
  // watermarks must be ordered below the hard cap or they are meaningless — clamp, never crash at boot
  cfg.normalWatermark = Math.min(cfg.normalWatermark, cfg.maxInFlight);
  cfg.sheddableWatermark = Math.min(cfg.sheddableWatermark, cfg.normalWatermark);
  return cfg;
}

export type AcquireResult = { ok: true; release: () => void } | { ok: false; retryAfterSec: number };

/** In-flight limiter. O(1) acquire/release; release is idempotent (a double release must never corrupt the count). */
export class ConcurrencyLimiter {
  private inFlight = 0;
  private shedTotals: Record<PriorityClass, number> = { critical: 0, normal: 0, sheddable: 0 };
  constructor(private readonly cfg: BackpressureConfig = DEFAULTS) {}

  get current(): number { return this.inFlight; }
  get shed(): Readonly<Record<PriorityClass, number>> { return this.shedTotals; }

  tryAcquire(cls: PriorityClass): AcquireResult {
    const limit = cls === 'critical' ? this.cfg.maxInFlight
      : cls === 'normal' ? this.cfg.normalWatermark
      : this.cfg.sheddableWatermark;
    if (this.inFlight >= limit) {
      this.shedTotals[cls] += 1;
      return { ok: false, retryAfterSec: this.cfg.retryAfterSec };
    }
    this.inFlight += 1;
    let released = false;
    return { ok: true, release: () => { if (!released) { released = true; this.inFlight -= 1; } } };
  }
}
