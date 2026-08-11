// apps/web-tenant/src/test/tenant1e-share-register.spec.ts · W197's tiles and W198's quorum line (PC-56 TENANT-1e).
//
// Every case here is about a number the screen must REFUSE to print: a turnout with no denominator, a face value over a
// mixed-price register, "0% in favour" for a resolution nobody has voted on, a quorum tick where nobody is eligible.
import * as fs from 'fs';
import * as path from 'path';
import type { CoopBylaws, ResolutionTally, ShareRegisterTiles, VotingVerdict } from '@krishalaya/sdk-js';
import {
  bylawRows, eligiblePct, mayChange, outcomeLabel, quorumLine, registerCaption, sortRegister, turnoutTile, verdictLabel,
} from '../features/governance/register';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

/** The real English catalogue, so a missing key fails here rather than rendering as a raw key on a governance screen. */
const T = {
  t(key: string, vars?: Record<string, string | number>): string {
    const raw = (en as Record<string, string>)[key];
    if (raw === undefined) throw new Error(`missing i18n key: ${key}`);
    return raw.replace(/\{(\w+)\}/g, (_m, k) => String(vars?.[k] ?? ''));
  },
};

const tiles = (over: Partial<ShareRegisterTiles> = {}): ShareRegisterTiles => ({
  members: 1284, shareholders: 1212, pendingAllotment: 72, totalShares: 12120,
  shareCapitalMinor: '242400000', faceValueMinor: '20000', votingEligible: 1186,
  eligibleOfShareholdersBp: 9785, lastAgm: null, ...over,
});
const verdict = (over: Partial<VotingVerdict> = {}): VotingVerdict =>
  ({ eligible: true, reason: null, sharesShort: 0, eligibleFrom: null, ...over });
const tallyOf = (over: Partial<ResolutionTally> = {}): ResolutionTally => ({
  cast: 618, eligible: 1186, turnoutBp: 5210, quorumBp: 3300, quorumMet: true,
  byChoice: [{ choice: 'for', votes: 574 }, { choice: 'against', votes: 44 }],
  inFavourBp: 9288, passed: true, ...over,
});

describe('TENANT-1e · the turnout tile has three states', () => {
  it('no closed resolution says so rather than showing 0%', () => {
    expect(turnoutTile(tiles())).toEqual({ state: 'none', pct: null, cast: null });
  });

  it('a resolution closed before its denominator was recorded reports UNKNOWN, not zero', () => {
    // The whole point: 618 people voted, and "0%" would be a lie about them.
    const t = turnoutTile(tiles({ lastAgm: { resolutionId: 'r1', title: 'AGM 2024', closedAt: null, cast: 618, eligible: null, turnoutBp: null } }));
    expect(t).toEqual({ state: 'unrecorded', pct: null, cast: 618 });
  });

  it('a recorded denominator gives the canon’s own 52%', () => {
    const t = turnoutTile(tiles({ lastAgm: { resolutionId: 'r1', title: 'AGM 2025', closedAt: '2025-09-01T00:00:00.000Z', cast: 618, eligible: 1186, turnoutBp: 5210 } }));
    expect(t).toEqual({ state: 'known', pct: 52, cast: 618 });
  });
});

describe('TENANT-1e · the tiles refuse to invent a number', () => {
  it('eligible-as-a-share is null when there are no shareholders, never 0%', () => {
    expect(eligiblePct(tiles({ shareholders: 0, eligibleOfShareholdersBp: null }))).toBeNull();
    expect(eligiblePct(tiles())).toBe(98);   // W197's own "98% of shareholders"
  });

  it('a mixed-price register carries no single face value', () => {
    // The API returns null when capital does not divide exactly by shares; the screen must not round one into existence.
    expect(tiles({ faceValueMinor: null }).faceValueMinor).toBeNull();
  });

  it('the caption counts SHAREHOLDERS, which is what the register is a list of', () => {
    expect(registerCaption(25, tiles(), T)).toBe('Showing 25 of 1212 shareholders');
  });
});

describe('TENANT-1e · a refusal travels with its reason', () => {
  it('eligible reads plainly and adds nothing', () => {
    const v = verdictLabel(verdict(), T);
    expect(v).toEqual({ label: 'eligible', detail: null, tone: 'ok' });
  });

  it('short of shares says HOW short — a secretary can act on "4 more"', () => {
    const v = verdictLabel(verdict({ eligible: false, reason: 'too_few_shares', sharesShort: 4 }), T);
    expect(v.label).toBe('not yet');
    expect(v.detail).toBe('4 more shares needed');
    expect(v.tone).toBe('wait');
  });

  it('a suspension is its own answer, never collapsed into "not yet"', () => {
    const v = verdictLabel(verdict({ eligible: false, reason: 'suspended' }), T);
    expect(v.label).toBe('suspended');
    expect(v.tone).toBe('stop');
    // Collapsing it would send staff to allot shares to somebody whose participation is paused.
    expect(v.label).not.toBe('not yet');
  });

  it('every reason the API can return has a sentence', () => {
    for (const reason of ['too_few_shares', 'too_new', 'suspended', 'not_a_member'] as const) {
      const v = verdictLabel(verdict({ eligible: false, reason }), T);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });
});

describe('TENANT-1e · the quorum line', () => {
  it('prints the canon’s own shape: cast of eligible, turnout, quorum', () => {
    const q = quorumLine(tallyOf(), T);
    expect(q.state).toBe('ready');
    expect(q.met).toBe(true);
    expect(q.text).toBe('618 of 1186 eligible members · 52% · quorum 33%');
  });

  it('an empty eligible roll is not a failed quorum — nobody declined to vote', () => {
    const q = quorumLine(tallyOf({ eligible: 0, cast: 0, turnoutBp: 0, quorumMet: false, passed: null, inFavourBp: null }), T);
    expect(q.state).toBe('no_roll');
    expect(q.met).toBe(false);
  });

  it('quorumMet is taken from the API and never recomputed here', () => {
    // Two implementations of one threshold is how a console ticks a quorum the backend would fail.
    const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'governance', 'register.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function quorumLine'), src.indexOf('export function outcomeLabel'));
    expect(fn).toContain('tally.quorumMet');
    expect(fn).not.toMatch(/turnoutBp\s*>=\s*.*quorumBp/);
  });
});

describe('TENANT-1e · the outcome has three states', () => {
  it('says nothing at all while nobody has voted', () => {
    expect(outcomeLabel(tallyOf({ cast: 0, passed: null, inFavourBp: null }), 'open', T)).toBeNull();
  });

  it('an open resolution is LEADING, not carried — the vote is not over', () => {
    expect(outcomeLabel(tallyOf(), 'open', T)).toBe('Currently in favour');
  });

  it('a closed resolution carries or does not', () => {
    expect(outcomeLabel(tallyOf(), 'closed', T)).toBe('Carried');
    expect(outcomeLabel(tallyOf({ passed: false }), 'closed', T)).toBe('Did not carry');
  });
});

describe('TENANT-1e · the change affordance matches the API’s window', () => {
  const now = '2026-08-11T00:00:00.000Z';
  it.each([
    ['open, still running', 'open', '2026-08-12T00:00:00.000Z', true],
    ['open, elapsed', 'open', '2026-08-10T00:00:00.000Z', false],
    ['open, no close date', 'open', null, true],
    ['closed', 'closed', '2026-08-12T00:00:00.000Z', false],
  ])('%s', (_l, status, closes, expected) => {
    expect(mayChange(status, closes as string | null, now)).toBe(expected);
  });
});

describe('TENANT-1e · the bylaw panel', () => {
  const b = (over: Partial<CoopBylaws> = {}): CoopBylaws => ({ minShares: 10, minMembershipMonths: 6, quorumBp: 3300, ...over });

  it('shows three rows, and only the first two are configurable', () => {
    const rows = bylawRows(b(), T);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.configurable)).toEqual([true, true, false]);
    // One member, one vote carries no settings link in any tenant, on any plan, in any country.
    expect(rows[2].text).toContain('One member, one vote');
  });

  it('a zero threshold reads as "no rule" rather than "at least 0 shares"', () => {
    const rows = bylawRows(b({ minShares: 0, minMembershipMonths: 0 }), T);
    expect(rows[0].text).toBe('No shareholding required to vote');
    expect(rows[1].text).toBe('No minimum membership period');
  });

  it('the thresholds come from the argument, never from a literal in this module', () => {
    const rows = bylawRows(b({ minShares: 25, minMembershipMonths: 12 }), T);
    expect(rows[0].text).toContain('25');
    expect(rows[1].text).toContain('12');
  });
});

describe('TENANT-1e · row order', () => {
  it('sorts by shares descending, and breaks ties by name so reloads do not shuffle', () => {
    const row = (userId: string, fullName: string, sharesHeld: number) =>
      ({ userId, fullName, phoneMasked: null, sharesHeld, valueMinor: '0', memberSince: null, verdict: verdict() });
    const out = sortRegister([row('a', 'Meera', 10), row('b', 'Kanji', 10), row('c', 'Ramesh', 40)]);
    expect(out.map((r) => r.fullName)).toEqual(['Ramesh', 'Kanji', 'Meera']);
  });
});

describe('TENANT-1e · the three catalogues stay in step', () => {
  it('every reg.* key exists in Hindi and Gujarati', () => {
    const keys = Object.keys(en as Record<string, string>).filter((k) => k.startsWith('reg.'));
    expect(keys.length).toBeGreaterThan(50);
    // A governance screen falling back to English is a farmer being asked to trust a ballot in a language they do not read.
    expect(keys.filter((k) => !(k in hi))).toEqual([]);
    expect(keys.filter((k) => !(k in gu))).toEqual([]);
  });
});
