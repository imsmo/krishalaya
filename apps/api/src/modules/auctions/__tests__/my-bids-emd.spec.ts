// API-W7 pure test for the EMD-hold computation (node-port lane). The my-bids read-model + the keyset
// SQL run against real Postgres in the integration suite; this asserts the pure float-free money math.
import { emdHeldMinor } from '../read-models/my-bids.read-model';

describe('emdHeldMinor', () => {
  it('uses the auction fixed emd_minor when no bps is configured', () => {
    expect(emdHeldMinor(500000n, 5000n, null)).toBe(5000n);
    expect(emdHeldMinor(500000n, 5000n, 0)).toBe(5000n);   // 0 bps falls back to fixed
  });
  it('computes a percentage of the LOT value (basis points) with integer truncation — no float', () => {
    // 1.5% of ₹1,234.56 (one unit) = 123456 * 150 / 10000 = 1851 (truncated, never 1851.84)
    expect(emdHeldMinor(123456n, 0n, 150)).toBe(1851n);
    // PC-56 TENANT-11a F-12: a per-unit bid of ₹655 on a 200 kg lot — 2% of the LOT (₹1,31,000) = ₹2,620
    expect(emdHeldMinor(65500n, 0n, 200, '200.000')).toBe(262000n);
  });
  it('F-27b: a flat emd_minor wins over a percentage — the same rule the entity charges', () => {
    // before 11a the read gave the percentage precedence and showed 10000 while the entity held 5000
    expect(emdHeldMinor(500000n, 5000n, 200)).toBe(5000n);
  });
});
