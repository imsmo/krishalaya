// apps/web-gov/src/test/rtl-span.spec.ts · PC-56 RTL-1f — the gov console's code isolate (`ltrText` / `ltrOrNull`, features/rtl/span.ts).
// Pinned to the byte: under ar (the preview, rtl language) a code, masked phone or instant is wrapped in LRI…PDI (U+2066 … U+2069); under
// en/hi/gu it is returned EXACTLY as given — no marks — so the en/hi/gu pages stay byte-identical. The gov console prints no money, so it has
// no money helper (test/rtl-static.spec.ts pins the 0).
import { LANGUAGES, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { LRI, PDI, ltrOrNull, ltrRun, ltrText } from '../features/rtl/span';

const SAMPLES = ['••••••318', 'test_scheme_a', '2026-10-05 06:00 UTC', '0192D2C4', '', 'a (b) c'];

describe('ltrText / ltrOrNull', () => {
  it('the marks are U+2066 / U+2069', () => {
    expect([LRI, PDI]).toEqual(['⁦', '⁩']);
    expect(ltrRun('x')).toBe('⁦x⁩');
  });
  it('under ar every sample is LRI + itself + PDI', () => {
    expect([...PREVIEW_LANGUAGES]).toEqual(['ar']);
    for (const s of SAMPLES) expect(ltrText(s, 'ar')).toBe(`⁦${s}⁩`);
    expect(ltrText('••••••318', 'ar')).toBe('⁦••••••318⁩');
  });
  it('under every live language (en / hi / gu) every sample comes back untouched', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(['en', 'gu', 'hi']);
    for (const l of LANGUAGES) for (const s of SAMPLES) expect([l.code, ltrText(s, l.code)]).toEqual([l.code, s]);
  });
  it('a coming-soon or unknown code is not a preview language: untouched', () => {
    for (const c of ['ur', 'ks', 'xx', '']) expect(ltrText('X-1', c)).toBe('X-1');
  });
  it('ltrOrNull: null stays null (the caller\'s dash is unchanged), a value follows ltrText', () => {
    expect(ltrOrNull(null, 'ar')).toBeNull();
    expect(ltrOrNull(null, 'en')).toBeNull();
    expect(ltrOrNull('2026-10-05 06:00 UTC', 'ar')).toBe('⁦2026-10-05 06:00 UTC⁩');
    expect(ltrOrNull('2026-10-05 06:00 UTC', 'gu')).toBe('2026-10-05 06:00 UTC');
  });
});
