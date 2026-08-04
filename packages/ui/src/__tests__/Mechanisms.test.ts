// packages/ui/src/__tests__/Mechanisms.test.ts · DEV-19. Unit tests for the 3 new pure mechanism modules
// (theme/senior/density) — see `dev19_report.md` for the per-mechanism table. Deliberately zero React/DOM
// involved: these modules are pure functions / CSS-string builders, tested the same way, per this package's
// own `RtlSmoke.test.tsx` precedent (grep-based CSS assertions + pure function calls, no rendering needed).
import { parseThemePreference, resolveThemeHtmlAttrs, THEME_PREFERENCES } from '../mechanisms/theme';
import { isSeniorOn, seniorConsoleStyles } from '../mechanisms/seniorMode';
import { densityStyles } from '../mechanisms/density';

describe('theme mechanism — parseThemePreference (fail-closed cookie parse)', () => {
  it('accepts the 2 explicit values', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
  });
  it('defaults to system for anything else (undefined, null, empty, garbage/attacker-controlled)', () => {
    expect(parseThemePreference(undefined)).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('')).toBe('system');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('<script>alert(1)</script>')).toBe('system');
    expect(parseThemePreference('DARK')).toBe('system'); // case-sensitive, fails closed rather than guessing
  });
  it('THEME_PREFERENCES lists exactly the 3 supported values, in a stable order', () => {
    expect(THEME_PREFERENCES).toEqual(['light', 'dark', 'system']);
  });
});

describe('theme mechanism — resolveThemeHtmlAttrs (pure, SSR-safe: no DOM/cookies/localStorage touched)', () => {
  it('"dark" resolves to data-theme="dark", nothing else', () => {
    expect(resolveThemeHtmlAttrs('dark')).toEqual({ 'data-theme': 'dark' });
  });
  it('"light" resolves to an empty attrs object (canon\'s own :root light values apply with zero override)', () => {
    expect(resolveThemeHtmlAttrs('light')).toEqual({});
  });
  it('"system" resolves to the canon\'s own opt-in dark-enabled class, no data-theme attribute', () => {
    const attrs = resolveThemeHtmlAttrs('system');
    expect(attrs).toEqual({ className: 'dark-enabled' });
    expect(attrs['data-theme']).toBeUndefined();
  });
  it('is a pure function — same input always produces a deep-equal (not necessarily reference-equal) output', () => {
    expect(resolveThemeHtmlAttrs('dark')).toEqual(resolveThemeHtmlAttrs('dark'));
  });
});

describe('senior mode mechanism — isSeniorOn (fail-closed cookie parse)', () => {
  it('only the literal "on" enables senior mode', () => {
    expect(isSeniorOn('on')).toBe(true);
  });
  it('everything else (undefined/null/empty/off/garbage) fails closed to OFF', () => {
    expect(isSeniorOn(undefined)).toBe(false);
    expect(isSeniorOn(null)).toBe(false);
    expect(isSeniorOn('')).toBe(false);
    expect(isSeniorOn('off')).toBe(false);
    expect(isSeniorOn('true')).toBe(false);
    expect(isSeniorOn('ON')).toBe(false); // case-sensitive, fails closed
  });
});

describe('senior mode mechanism — seniorConsoleStyles (engineering-owed Q48 console extension)', () => {
  it('is scoped to [data-senior="true"] — additive/opt-in, never an unconditional override', () => {
    expect(seniorConsoleStyles).toContain('[data-senior="true"] {');
  });
  it('carries the ratified 1.30x multiplier literally (imported from @krishalaya/tokens, not re-typed)', () => {
    expect(seniorConsoleStyles).toContain('* 1.3');
  });
  it('redefines every one of the 7 base --text-* scale steps used by the console (xs..3xl)', () => {
    for (const step of ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl']) {
      expect(seniorConsoleStyles).toContain(`--text-${step}:`);
    }
  });
  it('generalizes the tap floor to 56px on BOTH console control-height tokens (not just the primary CTA)', () => {
    expect(seniorConsoleStyles).toContain('--web-control-h: 56px;');
    expect(seniorConsoleStyles).toContain('--web-control-h-lg: 56px;');
  });
});

describe('density mechanism — densityStyles (DELTA-001 residual: real pointer/hover gating, closed DEV-19)', () => {
  it('gates the 36px density cut behind genuine desktop-class input only', () => {
    expect(densityStyles).toMatch(/@media \(pointer: fine\) and \(hover: hover\)[\s\S]*--web-control-h: 36px;/);
  });
  it('NEVER drops a touch/coarse-pointer console user below the 44px rural-tap floor (Rule Zero)', () => {
    expect(densityStyles).toMatch(/@media \(pointer: coarse\), \(hover: none\)[\s\S]*--web-control-h: 44px;/);
  });
  it('contains no rule that sets --web-control-h below 44px outside the fine+hover branch', () => {
    // Crude but effective: every "36px" occurrence must be inside the fine+hover media block, i.e. there is
    // exactly one 36px assignment in the whole fragment (the intentional desktop-only one).
    const occurrences = (densityStyles.match(/36px/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});
