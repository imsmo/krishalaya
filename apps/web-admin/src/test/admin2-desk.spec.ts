// apps/web-admin/src/test/admin2-desk.spec.ts · PC-56 ADMIN-2 console gates.
// A support dashboard is read by people who then judge other people. Every assertion here is about not letting a thin
// number look like a verdict — and about not letting a missing translation stay invisible.
import {
  MACRO_LANGUAGES, REQUIRED_LANGUAGE, MIN_BODY, buildMacro, missingLanguages, sortMacrosByCoverageRisk, usedButUnrated,
  humanSeconds, CSAT_MIN_SAMPLE, csatIsIndicative, reopenRateBps, sortAgentsByLoad,
  csatShares, LOW_SCORE_MAX, isLowScore, humanMinutes, matrixIsCoherent,
} from '../features/support/desk';

const body = (n = MIN_BODY + 5) => 'x'.repeat(n);

describe('macro authoring — a blank language is omitted, English is required', () => {
  const base = { slug: '/payout-verify-wait', title: 'Payout verification wait', bodies: { en: body() } };

  it('normalises the shortcut and keeps only the languages that were written', () => {
    const r = buildMacro({ ...base, bodies: { en: body(), hi: body(), gu: '   ' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.slug).toBe('payout-verify-wait');
      // gu was blank: omitted rather than rejected, because placeholder Gujarati looks reviewed and is not
      expect(r.value.bodies.map((b) => b.languageCode)).toEqual(['en', 'hi']);
    }
  });

  it('REQUIRES English, because it is what the desk reviews the others against', () => {
    expect(buildMacro({ ...base, bodies: { hi: body() } })).toEqual({ ok: false, error: 'english' });
    expect(REQUIRED_LANGUAGE).toBe('en');
    expect([...MACRO_LANGUAGES]).toEqual(['en', 'hi', 'gu']);
  });

  it('points at WHICH language failed, so a three-box form can highlight the right box', () => {
    expect(buildMacro({ ...base, bodies: { en: body(), gu: 'too short' } })).toEqual({ ok: false, error: 'body', at: 'gu' });
    expect(buildMacro({ ...base, bodies: { en: body(), hi: 'x'.repeat(4001) } })).toEqual({ ok: false, error: 'body', at: 'hi' });
  });

  it('refuses a shortcut nobody could type reliably, and a thin title', () => {
    for (const slug of ['ab', 'a b', 'payout--wait', 'Payout_Wait']) {
      expect(buildMacro({ ...base, slug })).toEqual({ ok: false, error: 'slug' });
    }
    expect(buildMacro({ ...base, title: 'x' })).toEqual({ ok: false, error: 'title' });
  });

  it('NAMES missing languages and puts the risky macros first', () => {
    expect(missingLanguages(['en'])).toEqual(['hi', 'gu']);
    expect(missingLanguages(['EN', 'hi', 'gu'])).toEqual([]);
    expect(missingLanguages(undefined)).toEqual(['en', 'hi', 'gu']);

    // the macro used 400 times with a missing language is being pasted in the wrong language all day — it sorts first,
    // ahead of a fully-translated macro used 900 times
    const sorted = sortMacrosByCoverageRisk([
      { slug: 'complete-often', languages: ['en', 'hi', 'gu'], uses30d: 900 },
      { slug: 'gap-rare', languages: ['en'], uses30d: 3 },
      { slug: 'gap-often', languages: ['en'], uses30d: 400 },
    ]);
    expect(sorted.map((m) => m.slug)).toEqual(['gap-often', 'gap-rare', 'complete-often']);
  });

  it('distinguishes "used but never rated" from "rated badly"', () => {
    expect(usedButUnrated({ uses30d: 20, csatAfterUseBps: null })).toBe(true);
    expect(usedButUnrated({ uses30d: 20, csatAfterUseBps: 4000 })).toBe(false);
    expect(usedButUnrated({ uses30d: 0, csatAfterUseBps: null })).toBe(false);
  });
});

describe('agent performance — a thin number must not read as a verdict', () => {
  it('formats a p50 and returns NULL when there is none', () => {
    expect(humanSeconds(45)).toBe('45s');
    expect(humanSeconds(600)).toBe('10m');
    expect(humanSeconds(3600)).toBe('1h');
    expect(humanSeconds(5400)).toBe('1h 30m');
    // an agent with nothing answered yet has no median — "0s" would make them look instant
    expect(humanSeconds(null)).toBeNull();
    expect(humanSeconds(undefined)).toBeNull();
    expect(humanSeconds(-1)).toBeNull();
  });

  it('will not treat a handful of ratings as indicative', () => {
    expect(CSAT_MIN_SAMPLE).toBe(10);
    expect(csatIsIndicative({ csatCount: 10 })).toBe(true);
    expect(csatIsIndicative({ csatCount: 9 })).toBe(false);
    expect(csatIsIndicative({})).toBe(false);
  });

  it('returns NULL reopen rate for an agent who handled nothing, not a perfect 0%', () => {
    expect(reopenRateBps({ handled: 20, reopenedCount: 1 })).toBe(500);
    expect(reopenRateBps({ handled: 0, reopenedCount: 0 })).toBeNull();
    expect(reopenRateBps({})).toBeNull();
  });

  it('sorts busiest first, which is the load-balance question', () => {
    const rows = sortAgentsByLoad([{ agentUserId: 'a', handled: 3 }, { agentUserId: 'b', handled: 30 }]);
    expect(rows.map((r) => r.agentUserId)).toEqual(['b', 'a']);
  });
});

describe('CSAT — an unrated window is not a bad one', () => {
  it('returns NO shares when nothing was rated, rather than five zeroes', () => {
    // five zeroes would draw a chart implying everybody scored 1
    expect(csatShares([])).toEqual([]);
    expect(csatShares([{ score: 5, n: 0 }, { score: 1, n: 0 }])).toEqual([]);
  });

  it('computes shares in basis points of the rated total', () => {
    expect(csatShares([{ score: 5, n: 3 }, { score: 1, n: 1 }])).toEqual([
      { score: 5, n: 3, shareBps: 7500 },
      { score: 1, n: 1, shareBps: 2500 },
    ]);
  });

  it('names the review queue', () => {
    expect(LOW_SCORE_MAX).toBe(3);
    expect(isLowScore(1)).toBe(true);
    expect(isLowScore(3)).toBe(true);
    expect(isLowScore(4)).toBe(false);
    expect(isLowScore(0)).toBe(false);       // 0 is not a valid score; the scale is 1-5
    expect(isLowScore(null)).toBe(false);
  });
});

describe('the SLA matrix — a page that checks rather than assumes', () => {
  it('formats minutes as a human reads them', () => {
    expect(humanMinutes(15)).toBe('15m');
    expect(humanMinutes(240)).toBe('4h');
    expect(humanMinutes(90)).toBe('1h 30m');
    expect(humanMinutes(1440)).toBe('1d');
    expect(humanMinutes(4320)).toBe('3d');
    expect(humanMinutes(0)).toBe('—');
    expect(humanMinutes(null)).toBe('—');
  });

  it('detects an INCOHERENT matrix, which would quietly mis-prioritise every ticket', () => {
    const good = [
      { severity: 'P0', firstResponseMinutes: 15, resolutionMinutes: 240 },
      { severity: 'P1', firstResponseMinutes: 60, resolutionMinutes: 480 },
      { severity: 'P2', firstResponseMinutes: 240, resolutionMinutes: 1440 },
    ];
    expect(matrixIsCoherent(good)).toBe(true);
    // P1 given LESS time than P0 — a real configuration mistake, and invisible unless something checks
    const bad = [
      { severity: 'P0', firstResponseMinutes: 60, resolutionMinutes: 240 },
      { severity: 'P1', firstResponseMinutes: 15, resolutionMinutes: 480 },
    ];
    expect(matrixIsCoherent(bad)).toBe(false);
    expect(matrixIsCoherent([])).toBe(false);
  });
});
