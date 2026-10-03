// packages/ui/src/__tests__/Contrast.test.ts · PC-56 TENANT-13d · the contrast law against the canon's own figures, and the
// brand-surface rule (Powered-by / trust surfaces). The law lives in @krishalaya/tokens (pure); this package re-exports it and is where
// the monorepo's ts-jest config for design-system code runs.
import {
  brandContrast, contrastRatio, formatRatio, relativeLuminance, normaliseHex, PLATFORM_BRAND_COLOURS, BRAND_PAIRS,
  showsPoweredBy, TRUST_SURFACES, isTrustSurface, seniorModeTypeScaleMultiplier,
} from '@krishalaya/tokens';
import { brandContrast as reExported, showsPoweredBy as reShows } from '../index';

describe('contrast law (WCAG 2.x)', () => {
  it('luminance endpoints: black 0, white 1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });
  it('black on white is 21:1, a colour on itself 1:1, and order does not matter', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
    expect(contrastRatio('#1e6f3f', '#1e6f3f')).toBe(1);
    expect(contrastRatio('#ffffff', '#1e6f3f')).toBeCloseTo(contrastRatio('#1e6f3f', '#ffffff'), 12);
  });
  it('canon W191: primary #1E6F3F on white = 6.2:1 (within 0.1)', () => {
    const r = contrastRatio('#1E6F3F', '#FFFFFF');
    expect(Math.abs(r - 6.2)).toBeLessThanOrEqual(0.1);
    expect(formatRatio(r)).toBe('6.2:1');
  });
  it('canon W191: accent #F39C12 on ink (#232A33) ≈ 6.6:1 (within 0.1)', () => {
    const r = contrastRatio('#F39C12', '#232A33');
    expect(Math.abs(r - 6.6)).toBeLessThanOrEqual(0.1);
    expect(formatRatio(r)).toBe('6.6:1');
  });
  it('a ratio just under a threshold is never printed on it', () => {
    expect(formatRatio(4.49)).toBe('4.4:1');
    expect(formatRatio(6.99)).toBe('6.9:1');
    expect(formatRatio(2.96)).toBe('2.9:1');
    expect(formatRatio(4.5)).toBe('4.5:1');
  });
  it('the canon brand passes AA on every pair and reports AAA honestly (primary on white fails AAA normal)', () => {
    const r = brandContrast(PLATFORM_BRAND_COLOURS);
    expect(r.passes).toBe(true);
    expect(r.pairs.map((p) => p.code)).toEqual(BRAND_PAIRS.map((p) => p.code));
    const pos = r.pairs.find((p) => p.code === 'primary_on_surface')!;
    expect(pos.aa).toBe(true); expect(pos.aaaLarge).toBe(true); expect(pos.aaa).toBe(false);
  });
  it('a 4.4:1 pair is refused and named with its ratio', () => {
    // #787878 on white is 4.42:1
    const r = brandContrast({ ...PLATFORM_BRAND_COLOURS, primary: '#787878' });
    expect(r.passes).toBe(false);
    expect(r.failing.map((p) => p.code)).toEqual(['primary_on_surface', 'surface_on_primary']);
    expect(r.failing[0].display).toBe('4.4:1');
    expect(r.minRatio).toBeLessThan(4.5);
  });
  it('only #rrggbb is a colour', () => {
    expect(normaliseHex('#1E6F3F')).toBe('#1e6f3f');
    for (const bad of ['1e6f3f', '#1e6f3', '#1e6f3fz', 'red', 'url(x)', '#1e6f3f;}', '']) expect(normaliseHex(bad)).toBeNull();
    expect(() => relativeLuminance('red')).toThrow();
  });
  it('Senior Farmer Mode multiplies type, never contrast', () => {
    const r = brandContrast(PLATFORM_BRAND_COLOURS);
    expect(r.seniorMode).toEqual({ typeScale: seniorModeTypeScaleMultiplier, changesContrast: false });
    expect(seniorModeTypeScaleMultiplier).toBe(1.3);
  });
  it('packages/ui re-exports the same law (one implementation)', () => {
    expect(reExported).toBe(brandContrast);
    expect(reShows).toBe(showsPoweredBy);
  });
});

describe('brand surfaces — Powered by Krishalaya', () => {
  it('the trust-surface list is exactly the canon\'s plus DEV-27\'s documents', () => {
    expect([...TRUST_SURFACES]).toEqual(['escrow', 'kyc', 'disputes', 'ledger_receipts', 'settlement_statements', 'tax_invoices']);
  });
  it('a trust surface always shows the mark, whatever the plan or the choice', () => {
    for (const s of TRUST_SURFACES) {
      expect(isTrustSurface(s)).toBe(true);
      expect(showsPoweredBy(s, true, true)).toBe(true);
    }
  });
  it('a brandable surface hides it only with the choice AND the plan feature', () => {
    expect(showsPoweredBy('storefront', false, false)).toBe(true);
    expect(showsPoweredBy('storefront', true, false)).toBe(true);
    expect(showsPoweredBy('storefront', false, true)).toBe(true);
    expect(showsPoweredBy('storefront', true, true)).toBe(false);
  });
});
