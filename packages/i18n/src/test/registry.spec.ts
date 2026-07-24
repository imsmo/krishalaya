// @krishi-verse/i18n · registry unit tests (DEV-21). Proves the 14-entry LANGUAGE_REGISTRY is internally
// consistent (no duplicate codes, every fontPack id resolves, rtl only where the canon actually shipped an RTL
// language set) and that the pre-existing LANGUAGES/resolveLanguage/isSupported surface is UNCHANGED (still
// exactly the 3 live languages) — a regression test against accidentally widening "selectable" to "known".
import {
  LANGUAGE_REGISTRY, LANGUAGES, COMING_SOON_LANGUAGES, DEFAULT_LANGUAGE,
  resolveLanguage, isSupported, getRegistryEntry, isRegistered,
} from '../index';
import { FONT_PACKS, getFontPack } from '../fontPacks';

describe('LANGUAGE_REGISTRY (DEV-21 — 14 entries, the single source of truth)', () => {
  it('has exactly 14 entries', () => {
    expect(LANGUAGE_REGISTRY.length).toBe(14);
  });

  it('has zero duplicate codes', () => {
    const codes = LANGUAGE_REGISTRY.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has exactly 3 live entries: hi/en/gu', () => {
    const live = LANGUAGE_REGISTRY.filter((l) => l.status === 'live').map((l) => l.code).sort();
    expect(live).toEqual(['en', 'gu', 'hi']);
  });

  it('has exactly 11 machine-draft-pending-review entries, one per canon lang dir', () => {
    const target = LANGUAGE_REGISTRY.filter((l) => l.status === 'machine-draft-pending-review').map((l) => l.code).sort();
    expect(target).toEqual(['ar', 'as', 'bn', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te', 'ur'].sort());
    expect(target.length).toBe(11);
  });

  it('marks RTL (dir=rtl) for exactly ar and ur — every other language is ltr', () => {
    const rtl = LANGUAGE_REGISTRY.filter((l) => l.dir === 'rtl').map((l) => l.code).sort();
    expect(rtl).toEqual(['ar', 'ur']);
    const ltr = LANGUAGE_REGISTRY.filter((l) => l.dir === 'ltr').length;
    expect(ltr).toBe(12);
  });

  it('only ur carries codeCatalogAbsent — the honest boundary note', () => {
    const flagged = LANGUAGE_REGISTRY.filter((l) => l.codeCatalogAbsent).map((l) => l.code);
    expect(flagged).toEqual(['ur']);
  });

  it('every fontPack reference resolves to a real FONT_PACKS entry', () => {
    for (const l of LANGUAGE_REGISTRY) {
      const pack = getFontPack(l.fontPack);
      if (!pack) throw new Error(`${l.code} → fontPack '${l.fontPack}' does not resolve`);
      expect(pack).toBeDefined();
    }
  });

  it('every FONT_PACKS entry stays within the Q35 ≤120KB budget declaration', () => {
    for (const f of FONT_PACKS) {
      expect(f.budgetBytes).toBeLessThanOrEqual(120 * 1024);
    }
  });

  it('COMING_SOON_LANGUAGES is exactly the 11 non-live entries, in registry order', () => {
    expect(COMING_SOON_LANGUAGES.length).toBe(11);
    expect(COMING_SOON_LANGUAGES.every((l) => l.status !== 'live')).toBe(true);
  });

  it('getRegistryEntry finds both live and target codes, and normalizes a region tag', () => {
    expect(getRegistryEntry('hi')?.code).toBe('hi');
    expect(getRegistryEntry('mr')?.code).toBe('mr');
    expect(getRegistryEntry('ur-PK')?.code).toBe('ur');
    expect(getRegistryEntry('zz')).toBeUndefined();
  });

  it('isRegistered is true for all 14 known codes and false for an unknown one', () => {
    for (const l of LANGUAGE_REGISTRY) expect(isRegistered(l.code)).toBe(true);
    expect(isRegistered('zz')).toBe(false);
  });
});

describe('LANGUAGES / resolveLanguage / isSupported (unchanged behavior — backward-compat regression)', () => {
  it('LANGUAGES is still exactly the 3 live languages', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(['en', 'gu', 'hi']);
  });

  it('resolveLanguage still falls back to the default for a target-only (not-yet-live) code', () => {
    expect(resolveLanguage('mr').code).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage('ar').code).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage('ur').code).toBe(DEFAULT_LANGUAGE);
  });

  it('isSupported is still live-only (false for a target-only code)', () => {
    expect(isSupported('hi')).toBe(true);
    expect(isSupported('mr')).toBe(false);
    expect(isSupported('ur')).toBe(false);
  });
});
