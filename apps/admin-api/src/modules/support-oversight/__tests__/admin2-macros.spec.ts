// apps/admin-api/src/modules/support-oversight/__tests__/admin2-macros.spec.ts · PC-56 ADMIN-2.
// A macro is a promise the platform makes repeatedly, in somebody's own language. Every rule here protects one
// property: an agent inserting the same shortcut gets the same true answer every time.
import {
  MACRO_LANGUAGES, REQUIRED_LANGUAGE, MIN_BODY, MAX_BODY, isMacroLanguage,
  assertSlug, assertBodies, missingLanguages, csatAfterUseBps,
} from '../domain/macro';
import { InvalidMacroError } from '../domain/support-oversight.errors';
import { SEVERITIES, SLA_MINUTES } from '../domain/sla';

const body = (n = MIN_BODY + 5) => 'x'.repeat(n);

describe('macro shortcuts — an agent types these mid-sentence', () => {
  it('strips a leading slash and lower-cases', () => {
    expect(assertSlug('/Payout-Verify-Wait')).toBe('payout-verify-wait');
    expect(assertSlug('  kyc-rejected  ')).toBe('kyc-rejected');
  });

  it('refuses anything unpredictable to type', () => {
    // spaces, capitals and double hyphens all produce a shortcut nobody can use at speed
    for (const bad of ['ab', 'a b', 'payout--wait', '-lead', 'trail-', 'payout_wait', 'x'.repeat(61)]) {
      expect(() => assertSlug(bad)).toThrow(InvalidMacroError);
    }
  });
});

describe('macro bodies — English is mandatory and only LIVE languages are allowed', () => {
  it('knows which languages are live', () => {
    expect([...MACRO_LANGUAGES]).toEqual(['en', 'hi', 'gu']);
    expect(REQUIRED_LANGUAGE).toBe('en');
    expect(isMacroLanguage('mr')).toBe(false);   // machine-draft-pending-review, per DEV-21
  });

  it('accepts a multi-language macro and returns it sorted', () => {
    const out = assertBodies([
      { languageCode: 'hi', body: body() }, { languageCode: 'EN', body: body() },
    ]);
    expect(out.map((b) => b.languageCode)).toEqual(['en', 'hi']);
  });

  it('REFUSES a macro with no English body', () => {
    // en is what the desk reviews the other languages against; a Hindi-only macro cannot be checked by most of the desk
    expect(() => assertBodies([{ languageCode: 'hi', body: body() }])).toThrow(InvalidMacroError);
  });

  it('REFUSES an unreviewed language rather than pasting a machine translation to a farmer', () => {
    expect(() => assertBodies([{ languageCode: 'en', body: body() }, { languageCode: 'mr', body: body() }]))
      .toThrow(InvalidMacroError);
    expect(() => assertBodies([{ languageCode: '', body: body() }])).toThrow(InvalidMacroError);
  });

  it('refuses a body too short to BE a canned answer, and one nobody would read', () => {
    expect(() => assertBodies([{ languageCode: 'en', body: 'we are on it' }])).toThrow(InvalidMacroError);
    expect(() => assertBodies([{ languageCode: 'en', body: body(MAX_BODY + 1) }])).toThrow(InvalidMacroError);
    expect(assertBodies([{ languageCode: 'en', body: body(MIN_BODY) }])).toHaveLength(1);
  });

  it('refuses two bodies for one language', () => {
    expect(() => assertBodies([
      { languageCode: 'en', body: body() }, { languageCode: 'en', body: body() },
    ])).toThrow(InvalidMacroError);
  });

  it('trims before measuring, so whitespace cannot pass the minimum', () => {
    expect(() => assertBodies([{ languageCode: 'en', body: `  ${'x'.repeat(5)}   ` }])).toThrow(InvalidMacroError);
  });
});

describe('macro coverage and quality signals', () => {
  it('NAMES the missing languages — the gap is invisible otherwise', () => {
    // a macro that exists only in English WILL be pasted in English to a Gujarati farmer
    expect(missingLanguages(['en'])).toEqual(['hi', 'gu']);
    expect(missingLanguages(['en', 'hi', 'gu'])).toEqual([]);
    expect(missingLanguages(['EN', 'GU'])).toEqual(['hi']);
    expect(missingLanguages([])).toEqual(['en', 'hi', 'gu']);
  });

  it('reports CSAT-after-use as NULL when nothing was rated, never 0%', () => {
    // a macro used twenty times with no ratings is a different fact from one that upset everybody
    expect(csatAfterUseBps(4.6)).toBe(9200);
    expect(csatAfterUseBps(5)).toBe(10000);
    expect(csatAfterUseBps(null)).toBeNull();
    expect(csatAfterUseBps(0)).toBeNull();
    expect(csatAfterUseBps(Number.NaN)).toBeNull();
  });
});

describe('the SLA matrix served to the console is the one the platform enforces', () => {
  it('is the real code constant, not an invented table', () => {
    // W054 asks for an editable matrix; there is no config table, so the console shows THESE numbers and says so
    expect([...SEVERITIES]).toEqual(['P0', 'P1', 'P2', 'P3']);
    expect(SLA_MINUTES.P0).toEqual({ firstResponse: 15, resolution: 240 });
    expect(SLA_MINUTES.P3).toEqual({ firstResponse: 480, resolution: 4320 });
    // and the targets must tighten as severity rises, or the matrix is nonsense
    const rows = SEVERITIES.map((s) => SLA_MINUTES[s]);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].firstResponse).toBeGreaterThan(rows[i - 1].firstResponse);
      expect(rows[i].resolution).toBeGreaterThan(rows[i - 1].resolution);
    }
  });
});
