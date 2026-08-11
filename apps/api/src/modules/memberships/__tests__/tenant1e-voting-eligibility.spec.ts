// modules/memberships/__tests__/tenant1e-voting-eligibility.spec.ts · the ballot box (PC-56 TENANT-1e).
//
// The defect this wave closed: `POST /v1/governance/:id/vote` had no permission decorator and no eligibility check, so any
// authenticated user in the tenant could cast a ballot in an FPO's annual general meeting.
//
// **THE VALUE-LEVEL TESTS BELOW CANNOT SEE THAT DEFECT COMING BACK, AND THAT IS THE LESSON THIS FILE IS BUILT AROUND.** A
// suite that asserts `eligibility()` returns the right verdict passes just as happily when nobody calls it. So the guards at
// the bottom read the source of the vote path, the repository and the whole app, and FAIL when a rule stops running — the
// shape that caught the six `payouts.status = 'paid'` comparisons and the seven ungrantable permissions in earlier waves.
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_MIN_MONTHS, DEFAULT_MIN_SHARES, DEFAULT_QUORUM_BP,
  NotEligibleToVoteError, assertEligible, bylawsFrom, eligibility, eligibleFrom, mayChangeVote, tally,
} from '../domain/voting-eligibility';
import { GovernanceService } from '../services/governance.service';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
/** Comments have corrupted a whole batch of verdicts once already (TENANT-1c). Every source guard scans CODE. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

const BYLAWS = { minShares: 10, minMembershipMonths: 6, quorumBp: 3300 };
const NOW = new Date('2026-08-11T00:00:00.000Z');
const member = (over: Partial<{ isMember: boolean; memberSince: string | null; sharesHeld: number; suspended: boolean }> = {}) => ({
  isMember: true, memberSince: '2020-01-01T00:00:00.000Z', sharesHeld: 40, suspended: false, ...over,
});

describe('TENANT-1e · who may vote', () => {
  it('a delivery partner with no member role is refused — the defect in one assertion', () => {
    const v = eligibility(member({ isMember: false, memberSince: null, sharesHeld: 0 }), BYLAWS, NOW);
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe('not_a_member');
  });

  it('a member imported this morning with no shares is refused, and told how many are short', () => {
    const v = eligibility(member({ sharesHeld: 6, memberSince: '2019-01-01T00:00:00.000Z' }), BYLAWS, NOW);
    expect(v.reason).toBe('too_few_shares');
    expect(v.sharesShort).toBe(4);
  });

  it('a shareholder inside the tenure rule is refused, and given the DATE — W197’s "eligible Nov 2026"', () => {
    const v = eligibility(member({ memberSince: '2026-05-14T00:00:00.000Z' }), BYLAWS, NOW);
    expect(v.reason).toBe('too_new');
    expect(v.eligibleFrom).toBe('2026-11-14T00:00:00.000Z');
  });

  // **THE BOUNDARY, WHICH A MUTATION FOUND MISSING.** W197's rule is "holds >= 10 shares", and the first version of this
  // suite tested 6 and 40 — so `< minShares` could become `< minShares - 1` and every 9-share member in the co-operative
  // would have been enfranchised without a single assertion noticing.
  it.each([[8, false], [9, false], [10, true], [11, true]])(
    'a member holding %i shares against a 10-share bylaw: eligible = %s',
    (shares, expected) => {
      expect(eligibility(member({ sharesHeld: shares as number }), BYLAWS, NOW).eligible).toBe(expected);
    },
  );

  it('a suspended member keeps their shares and loses the ballot (TENANT-1b-2’s asymmetry)', () => {
    const v = eligibility(member({ suspended: true }), BYLAWS, NOW);
    expect(v.reason).toBe('suspended');
    // Not reported as a shareholding problem: a secretary must not be sent to allot shares to somebody who is suspended.
    expect(v.sharesShort).toBe(0);
  });

  it('order of refusals: a non-member who is ALSO short of shares is told they are not a member', () => {
    const v = eligibility(member({ isMember: false, sharesHeld: 1, memberSince: null }), BYLAWS, NOW);
    expect(v.reason).toBe('not_a_member');
  });

  it('assertEligible throws a 403 that names the reason and carries what is missing', () => {
    try {
      assertEligible(eligibility(member({ sharesHeld: 1 }), BYLAWS, NOW));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NotEligibleToVoteError);
      const err = e as NotEligibleToVoteError;
      // 403, so the console can tell a refusal-by-rule apart from a validation error or a missing resolution.
      expect(err.httpStatus).toBe(403);
      expect(err.details?.reason).toBe('too_few_shares');
      expect(err.details?.sharesShort).toBe(9);
    }
  });

  it('an eligible member passes and assertEligible does not throw', () => {
    const v = eligibility(member(), BYLAWS, NOW);
    expect(v.eligible).toBe(true);
    expect(() => assertEligible(v)).not.toThrow();
  });
});

describe('TENANT-1e · the bylaws are data, and a broken bylaw never opens the gate', () => {
  it('missing settings fall back to the canon’s published defaults', () => {
    const b = bylawsFrom(null);
    expect(b).toEqual({ minShares: DEFAULT_MIN_SHARES, minMembershipMonths: DEFAULT_MIN_MONTHS, quorumBp: DEFAULT_QUORUM_BP });
  });

  it.each([['nonsense'], [-4], [null], [undefined], [{}], [Number.NaN]])(
    'a malformed min_shares_to_vote (%p) becomes the STRICTER default, never 0',
    (bad) => {
      const b = bylawsFrom({ 'governance.min_shares_to_vote': bad });
      expect(b.minShares).toBe(DEFAULT_MIN_SHARES);
      // The defect this whole wave exists to close is "everybody may vote". A corrupt setting must not recreate it.
      expect(b.minShares).not.toBe(0);
    },
  );

  it('a quorum of 0 is refused — one vote must not carry a resolution for 1,284 members', () => {
    expect(bylawsFrom({ 'governance.quorum_bp': '0' }).quorumBp).toBe(DEFAULT_QUORUM_BP);
    expect(bylawsFrom({ 'governance.quorum_bp': '20000' }).quorumBp).toBe(DEFAULT_QUORUM_BP);
  });

  it('a DELIBERATE zero shareholding rule is honoured — a producer company may vote by membership alone', () => {
    // 0130 documents this case explicitly, so it must survive: the guard above is about MALFORMED values, not about
    // overriding a founder who set the rule to zero on purpose.
    const b = bylawsFrom({ 'governance.min_shares_to_vote': '0' });
    expect(b.minShares).toBe(0);
    expect(eligibility(member({ sharesHeld: 0 }), b, NOW).eligible).toBe(true);
  });

  it('the bylaws are read from settings, not compiled in — a Bangladeshi society is not Gujarat', () => {
    const b = bylawsFrom({ 'governance.min_shares_to_vote': '25', 'governance.min_membership_months': '12', 'governance.quorum_bp': '5100' });
    expect(b).toEqual({ minShares: 25, minMembershipMonths: 12, quorumBp: 5100 });
  });
});

describe('TENANT-1e · the tenure date is calendrical', () => {
  it('31 August + 6 months clamps to the end of February, not into March', () => {
    expect(eligibleFrom('2025-08-31T00:00:00.000Z', 6)).toBe('2026-02-28T00:00:00.000Z');
  });

  it('a leap year clamps to the 29th', () => {
    expect(eligibleFrom('2023-08-31T00:00:00.000Z', 6)).toBe('2024-02-29T00:00:00.000Z');
  });

  it('an ordinary date keeps its day of month', () => {
    expect(eligibleFrom('2026-05-14T00:00:00.000Z', 6)).toBe('2026-11-14T00:00:00.000Z');
  });

  it('an unknown join date yields no date rather than today', () => {
    expect(eligibleFrom(null, 6)).toBeNull();
    expect(eligibleFrom('not-a-date', 6)).toBeNull();
  });
});

describe('TENANT-1e · ONE MEMBER, ONE VOTE', () => {
  it('a 40-share member and a 10-share member count exactly the same', () => {
    // The canon's own words: "shares add capital, never extra votes (coop principle, enforced)". The enforcement is
    // structural — `tally` receives COUNTS and there is no parameter through which a shareholding could enter it.
    const t = tally([{ choice: 'for', votes: 2 }], 2, 3300);
    expect(t.cast).toBe(2);
    expect(t.inFavourBp).toBe(10_000);
  });

  it('the tally signature cannot express a weighting', () => {
    const src = stripComments(read('domain/voting-eligibility.ts'));
    const sig = /export function tally\(([^)]*)\)/.exec(src)?.[1] ?? '';
    expect(sig).toContain('byChoice');
    expect(sig).toContain('eligible');
    expect(sig).toContain('quorumBp');
    // No shares, no register, no weights — anywhere in the signature.
    expect(sig).not.toMatch(/share/i);
    expect(sig).not.toMatch(/weight/i);
    // And the domain file must not reach for the register at all.
    expect(src).not.toContain('coop_share_registers');
  });

  it('turnout is measured against ELIGIBLE members, never all members', () => {
    // W197: 1,212 shareholders of 1,284 members, 1,186 eligible. W198's tally reads 618 / 1,186.
    const t = tally([{ choice: 'for', votes: 574 }, { choice: 'against', votes: 44 }], 1186, 3300);
    expect(t.cast).toBe(618);
    expect(t.turnoutBp).toBe(5210);           // 52%, matching the canon's own figure
    expect(t.quorumMet).toBe(true);
    expect(t.inFavourBp).toBe(9288);          // "93% of cast"
    expect(t.passed).toBe(true);
  });

  it('quorum is NOT vacuously met when nobody is eligible', () => {
    const t = tally([], 0, 3300);
    expect(t.turnoutBp).toBe(0);
    expect(t.quorumMet).toBe(false);
    expect(t.passed).toBeNull();
  });

  it('a quorum of zero does NOT become vacuously met when nobody is eligible', () => {
    // Also found by a mutation: with `turnoutBp` pinned to 0 for an empty roll, `0 >= 0` is true, so a caller who reached
    // `tally` with quorumBp 0 (bypassing `bylawsFrom`, which refuses it) would have been told a resolution carried on a
    // register where not one member could vote.
    const t = tally([{ choice: 'for', votes: 5 }], 0, 0);
    expect(t.quorumMet).toBe(false);
    expect(t.passed).toBeNull();
  });

  it('no votes yet reports null in favour rather than 0% — no votes is not a rejection', () => {
    const t = tally([], 500, 3300);
    expect(t.inFavourBp).toBeNull();
    expect(t.passed).toBeNull();
  });

  it('a resolution that reaches quorum but not a majority does not pass', () => {
    const t = tally([{ choice: 'for', votes: 200 }, { choice: 'against', votes: 200 }], 500, 3300);
    expect(t.quorumMet).toBe(true);
    expect(t.passed).toBe(false);            // a tie is not a majority
  });

  it('a majority that misses quorum does not pass', () => {
    const t = tally([{ choice: 'for', votes: 10 }], 1000, 3300);
    expect(t.inFavourBp).toBe(10_000);
    expect(t.quorumMet).toBe(false);
    expect(t.passed).toBe(false);
  });
});

describe('TENANT-1e · a vote is changeable until close (W198), and final after', () => {
  it.each([
    ['open, window still running', 'open', '2026-08-12T18:00:00.000Z', true],
    ['open, window elapsed', 'open', '2026-08-10T18:00:00.000Z', false],
    ['open with no close date', 'open', null, true],
    ['closed', 'closed', '2026-08-12T18:00:00.000Z', false],
    ['draft', 'draft', '2026-08-12T18:00:00.000Z', false],
  ])('%s', (_label, status, closes, expected) => {
    expect(mayChangeVote(status, closes as string | null, NOW)).toBe(expected);
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE GUARDS — these fail when a rule stops RUNNING, which no assertion above can detect                            */
/* ---------------------------------------------------------------------------------------------------------------- */

describe('TENANT-1e · the gate runs, and runs before any write', () => {
  const voteSrc = () => stripComments(read('services/governance.service.ts'));

  it('vote() calls assertEligible', () => {
    expect(voteSrc()).toContain('assertEligible(');
  });

  it('assertEligible is called BEFORE the transaction opens — a refused ballot writes nothing and locks nothing', () => {
    const src = voteSrc();
    const vote = src.slice(src.indexOf('async vote('), src.indexOf('async eligibilityFor('));
    const gate = vote.indexOf('assertEligible(');
    const tx = vote.indexOf('this.uow.run(');
    expect(gate).toBeGreaterThan(-1);
    expect(tx).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(tx);
  });

  it('the verdict is built from the tenant’s own bylaws, not from a literal', () => {
    const src = voteSrc();
    const vote = src.slice(src.indexOf('async vote('), src.indexOf('async eligibilityFor('));
    expect(vote).toContain('bylawSettings(');
    expect(vote).toContain('bylawsFrom(');
    expect(vote).toContain('voterFacts(');
  });

  it('the change path exists and is guarded by the domain rule, not by the checks above it', () => {
    const src = voteSrc();
    const vote = src.slice(src.indexOf('async vote('), src.indexOf('async eligibilityFor('));
    expect(vote).toContain('mayChangeVote(');
    expect(vote).toContain('changeVote(');
    // The old flat refusal must be gone: it is the sentence a farmer saw after one mis-tap.
    expect(vote).not.toContain('you have already voted');
  });

  it('results() supplies a denominator and a quorum — W198 printed both with nothing behind them', () => {
    const src = voteSrc();
    const res = src.slice(src.indexOf('async results('));
    expect(res).toContain('eligibleCount(');
    expect(res).toContain('quorumBp');
  });

  it('closing a resolution records the eligible roll — a turnout keeps its own denominator', () => {
    const src = voteSrc();
    const t = src.slice(src.indexOf('async transition('), src.indexOf('async vote('));
    expect(t).toContain('recordEligibleAtClose(');
    expect(t).toContain('eligibleCount(');
  });

  it('a vote-service surface exists for every promise the register screen makes', () => {
    // Enumerated, so a removed method fails here rather than surfacing as a blank panel.
    for (const m of ['async vote(', 'async eligibilityFor(', 'async results(', 'async transition(']) {
      expect(voteSrc()).toContain(m);
    }
    expect(typeof GovernanceService).toBe('function');
  });
});

describe('TENANT-1e · the SQL rule and the TypeScript rule are the same rule', () => {
  const repoSrc = () => stripComments(read('repositories/governance.repository.ts'));

  it('the tenure clause ADDS months to the join date rather than subtracting them from now()', () => {
    // Postgres clamps a short month on ADDITION exactly as `eligibleFrom` does. Subtracting from now() differs by up to
    // three days for anybody who joined at a month end — which would make the register table and the vote gate disagree
    // about the same person on the same day.
    const src = repoSrc();
    expect(src).toContain('(member_since + make_interval(months => $4::int)) <= now()');
    expect(src).not.toMatch(/member_since\s*<=\s*\(?\s*now\(\)\s*-/);
  });

  it('the eligible count is expressed in SQL exactly ONCE', () => {
    const src = repoSrc();
    // `eligibleCount` must delegate; two independent SQL expressions of one rule is how they drift apart.
    const fn = src.slice(src.indexOf('async eligibleCount('), src.indexOf('async castVote('));
    expect(fn).toContain('registerTotals(');
    expect(fn).not.toContain('SELECT');
  });

  it('eligibility is counted FROM members with the register joined, not FROM the register', () => {
    // With `min_shares_to_vote = 0` — which 0130 declares legitimate — counting from `coop_share_registers` drops every
    // member who has no register row, shrinking the quorum denominator and making quorum trivially easy to reach.
    const src = repoSrc();
    const fn = src.slice(src.indexOf('async registerTotals('), src.indexOf('async registerPage('));
    expect(fn).toContain('FROM user_tenant_roles');
    expect(fn).toContain('LEFT JOIN coop_share_registers');
    expect(fn).not.toMatch(/FROM coop_share_registers\s+csr\s*\n\s*WHERE/);
  });

  it('membership means a MEMBER-kind role — staff codes are absent on purpose', () => {
    const src = repoSrc();
    const list = /export const MEMBER_ROLE_CODES = \[([^\]]*)\]/.exec(src)?.[1] ?? '';
    expect(list).toContain('farmer');
    for (const staff of ['tenant_admin', 'tenant_staff', 'fpo_coordinator', 'support_agent', 'auditor', 'delivery_partner']) {
      // Running the organisation is not owning it.
      expect(list).not.toContain(staff);
    }
  });

  it('a changed vote is an UPDATE on the one row, never a second ballot', () => {
    const src = repoSrc();
    const fn = src.slice(src.indexOf('async changeVote('));
    expect(fn).toContain('UPDATE coop_votes');
    expect(fn).not.toContain('INSERT');
    // The primary key IS the one-member-one-vote guarantee, so the change must not relax it.
    expect(fn).toContain('member_user_id');
  });
});

describe('TENANT-1e · the stored eligibility flag stays unread', () => {
  it('nothing in apps/api reads or writes coop_share_registers.voting_eligible', () => {
    // 0130 documents the column as deliberately unread: a stored verdict says "eligible" for somebody who transferred their
    // shares away last week. This guard is what stops a future wave from quietly trusting it.
    const root = path.join(__dirname, '..', '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.ts')) continue;
        if (p === __filename) continue;
        const src = stripComments(fs.readFileSync(p, 'utf8'));
        if (src.includes('voting_eligible')) hits.push(path.relative(root, p));
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
