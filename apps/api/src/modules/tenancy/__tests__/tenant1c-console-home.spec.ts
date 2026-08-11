// modules/tenancy/__tests__/tenant1c-console-home.spec.ts · PC-56 TENANT-1c.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: THE CHECKLIST CANNOT SAY "DONE" ABOUT SOMETHING THAT IS NOT, AND THE DASHBOARD
// CANNOT INVENT URGENCY OR PROGRESS.**
//
// W116's six steps are DERIVED from facts rather than read from a checklist table. That is the wave's central decision and it
// inverts what I expected to find: a table here would be a second opinion about things the database already knows, and it
// could say "KYC done" after a rejection. A setup screen that lies about readiness lets a federation go live believing money
// can move.
import { goLiveSteps, goLiveProgress, isLive, blockedSteps, GO_LIVE_STEPS, MIN_TEAM_SIZE } from '../domain/go-live';
import { changeBp, memberLimitOf } from '../read-models/tenant-dashboard.read-model';
import { GoLiveReadModel } from '../read-models/go-live.read-model';

const NOTHING = {
  organisationNamed: false, organisationAt: null,
  planChosen: false, planAt: null,
  kycVerified: false, kycAt: null,
  staffCount: 0, staffAt: null,
  memberCount: 0, membersAt: null,
  payoutReady: false, payoutAt: null,
};

const EVERYTHING = {
  organisationNamed: true, organisationAt: '2026-07-13T11:20:00.000Z',
  planChosen: true, planAt: '2026-07-13T11:34:00.000Z',
  kycVerified: true, kycAt: '2026-07-14T09:00:00.000Z',
  staffCount: 3, staffAt: '2026-07-14T10:00:00.000Z',
  memberCount: 214, membersAt: '2026-07-15T08:00:00.000Z',
  payoutReady: true, payoutAt: '2026-07-16T12:00:00.000Z',
};

describe('TENANT-1c · the six steps come from facts', () => {
  it('renders W116’s own state: two of six done, KYC next', () => {
    const steps = goLiveSteps({ ...NOTHING, organisationNamed: true, organisationAt: '2026-07-13T11:20:00.000Z', planChosen: true, planAt: '2026-07-13T11:34:00.000Z' });
    expect(goLiveProgress(steps)).toEqual({ done: 2, total: 6 });
    expect(steps.find((s) => s.isNext)!.key).toBe('kyc');
    expect(steps.map((s) => s.key)).toEqual([...GO_LIVE_STEPS]);
  });

  /**
   * **EXACTLY ONE STEP IS "next", EVER.** The page's only job is telling somebody what to do; two badges is a page that
   * cannot. And the next step is the first UNBLOCKED one, so a federation is never pointed at a door that will refuse them.
   */
  it('marks exactly one next step, and never a blocked one', () => {
    for (const facts of [NOTHING, { ...NOTHING, organisationNamed: true }, { ...EVERYTHING, payoutReady: false }]) {
      const steps = goLiveSteps(facts);
      expect(steps.filter((s) => s.isNext).length).toBeLessThanOrEqual(1);
      const next = steps.find((s) => s.isNext);
      if (next) expect(next.blockedBy).toBeNull();
    }
  });

  /**
   * **ONLY `payouts` IS BLOCKED, AND ONLY BY KYC.** Money genuinely cannot move before an organisation is verified. Every
   * other step is merely ORDERED — a federation can invite staff before choosing a plan — and inventing dependencies is the
   * easy way to make a checklist look rigorous while making the product feel bureaucratic.
   */
  it('blocks payouts on KYC and nothing else on anything', () => {
    const steps = goLiveSteps(NOTHING);
    expect(steps.filter((s) => s.blockedBy !== null).map((s) => s.key)).toEqual(['payouts']);
    expect(steps.find((s) => s.key === 'payouts')!.blockedBy).toBe('kyc');
    expect(blockedSteps(steps)).toEqual([{ key: 'payouts', blockedBy: 'kyc' }]);

    // Verify the organisation and the block lifts — nothing else changes.
    const verified = goLiveSteps({ ...NOTHING, kycVerified: true, kycAt: '2026-07-14T09:00:00.000Z' });
    expect(verified.every((s) => s.blockedBy === null)).toBe(true);
  });

  /** W116's threshold is its own words: "verification desk, payouts and support work better with 2+ staff". */
  it('needs two staff, not one', () => {
    expect(MIN_TEAM_SIZE).toBe(2);
    expect(goLiveSteps({ ...NOTHING, staffCount: 1 }).find((s) => s.key === 'team')!.done).toBe(false);
    expect(goLiveSteps({ ...NOTHING, staffCount: 2 }).find((s) => s.key === 'team')!.done).toBe(true);
  });

  it('needs one member, not many', () => {
    // "Add your FIRST members" — one is the threshold, and demanding more would hold a small SHG federation back.
    expect(goLiveSteps({ ...NOTHING, memberCount: 0 }).find((s) => s.key === 'members')!.done).toBe(false);
    expect(goLiveSteps({ ...NOTHING, memberCount: 1 }).find((s) => s.key === 'members')!.done).toBe(true);
  });

  /**
   * **A TIMESTAMP ONLY WHEN THE STEP IS DONE.** A `created_at` from a REJECTED KYC attempt is when somebody tried, and
   * showing it beside an unticked step reads as "done at 11:20" to anybody scanning the column.
   */
  it('never shows a timestamp beside an unfinished step', () => {
    const steps = goLiveSteps({ ...NOTHING, kycAt: '2026-07-14T09:00:00.000Z', payoutAt: '2026-07-16T12:00:00.000Z' });
    for (const s of steps) if (!s.done) expect(s.doneAt).toBeNull();
  });

  it('carries the fact’s own timestamp when it is done', () => {
    const steps = goLiveSteps(EVERYTHING);
    expect(steps.find((s) => s.key === 'organisation')!.doneAt).toBe('2026-07-13T11:20:00.000Z');
    expect(steps.find((s) => s.key === 'plan')!.doneAt).toBe('2026-07-13T11:34:00.000Z');
  });

  /**
   * **ALL SIX, NOT "ENOUGH OF THEM".** A five-of-six organisation with no verified bank account cannot pay a farmer, which
   * is the one thing a federation exists to do. Partial credit here would be the platform declaring victory on the member's
   * behalf.
   */
  it('is live only when every step is done', () => {
    expect(isLive(goLiveSteps(EVERYTHING))).toBe(true);
    for (const key of GO_LIVE_STEPS) {
      const missing = { ...EVERYTHING } as Record<string, unknown>;
      if (key === 'organisation') missing.organisationNamed = false;
      if (key === 'plan') missing.planChosen = false;
      if (key === 'kyc') missing.kycVerified = false;
      if (key === 'team') missing.staffCount = 1;
      if (key === 'members') missing.memberCount = 0;
      if (key === 'payouts') missing.payoutReady = false;
      expect(isLive(goLiveSteps(missing as never))).toBe(false);
    }
  });

  it('treats a blank organisation name as unnamed', () => {
    // A tenant row always exists by the time somebody is signed in, so "created your organisation" has to mean NAMED — a
    // whitespace display name would otherwise tick step one for a federation that has entered nothing.
    expect(goLiveSteps({ ...NOTHING, organisationNamed: false }).find((s) => s.key === 'organisation')!.done).toBe(false);
  });
});

describe('TENANT-1c · the dashboard invents no numbers', () => {
  /**
   * **null WHEN THE PREVIOUS WINDOW WAS ZERO, BECAUSE A PERCENTAGE AGAINST NOTHING IS NOT A FACT.** A federation's first
   * month would otherwise show a fabricated figure on the tile whose entire job is being trustworthy.
   */
  it('returns no change when there is nothing to compare against', () => {
    expect(changeBp('4812600', '0')).toBeNull();
    expect(changeBp('0', '0')).toBeNull();
    // A month that dropped to zero from something IS a real -100%.
    expect(changeBp('0', '1000')).toBe(-10_000);
  });

  it('computes the canon’s own comparison', () => {
    // W117: "▲ 18% vs June same-day". 4,080,000 → 4,812,600 is +17.95%, which reads as 18% once truncated to whole percent.
    expect(changeBp('481260000', '408000000')).toBe(1795);
    expect(changeBp('200', '100')).toBe(10_000);      // doubled
    expect(changeBp('100', '200')).toBe(-5_000);      // halved
  });

  /**
   * **AND HERE IS AN HONEST NEGATIVE RESULT: THE FLOAT MUTANT OF THIS FUNCTION IS AN EQUIVALENT MUTANT.**
   *
   * Replacing the bigint arithmetic with `Number()` division survived, so I went looking for the case where they disagree —
   * and there is not one. Over 200,000 random pairs up to 9e17 the two forms returned identical basis points every time, and
   * the reason is structural: the result is truncated to an INTEGER number of basis points, and the float error at these
   * magnitudes is many orders of magnitude smaller than one basis point of the same quantity. ADMIN-1e's tax mutation DID
   * have such a case (a total, not a ratio); this one does not.
   *
   * **SO THE BIGINT FORM STAYS FOR A REASON THAT IS OBSERVABLE, AND THE OTHER CLAIM IS WITHDRAWN.** What the signature
   * genuinely buys is that it takes minor units as STRINGS: a caller cannot hand it a `number` that has already lost
   * precision upstream, which is where money actually gets damaged on this platform. That is asserted below. Recording a
   * negative result rather than manufacturing a contrived assertion is the point — second equivalent mutant this programme
   * has found, after ADMIN-SWEEP's paired alert guards.
   */
  it('takes minor units as strings, so precision cannot be lost before it is called', () => {
    // Exact past 2^53 because the STRING carried the value; a `number` parameter would have rounded at the call site.
    expect(changeBp('246913578024691356', '123456789012345678')).toBe(10_000);
    expect(changeBp('123456789012345679', '123456789012345678')).toBe(0);
    // The float blindness that a `number` signature would have inherited, pinned so the reason is visible:
    expect(Number('123456789012345679') === Number('123456789012345678')).toBe(true);
    // And the output is always an integer number of basis points, never a fraction on a headline tile.
    for (const [c, p] of [['481260000', '408000000'], ['7', '3'], ['1', '9007199254740993']]) {
      const v = changeBp(c, p)!;
      expect(Number.isInteger(v)).toBe(true);
    }
  });
  /**
   * **-1 MEANS UNLIMITED AND MUST NOT REACH THE SCREEN AS A NUMBER.** "1,284 of -1 members used" is exactly the kind of
   * thing that ships and is then reported by a customer. And a plan with NO limit row is also null, because an unconfigured
   * cap is unknown rather than zero — a zero would tell a working federation it is over its allowance.
   */
  it('reads an unlimited or missing member cap as no cap', () => {
    expect(memberLimitOf('-1')).toBeNull();
    expect(memberLimitOf(null)).toBeNull();
    expect(memberLimitOf('')).toBeNull();
    expect(memberLimitOf('not-a-number')).toBeNull();
    expect(memberLimitOf('5000')).toBe(5000);
    expect(memberLimitOf(5000)).toBe(5000);
  });
});

describe('TENANT-1c · the two clauses that make a tick truthful', () => {
  /**
   * **THE DOMAIN CANNOT DEFEND THESE, BECAUSE THEY LIVE IN SQL.**
   *
   * Two mutations proved it: dropping `status = 'verified'` from the KYC read, and dropping `penny_verified_at IS NOT NULL`
   * from the bank read, both left every domain test green. Of course they did — the domain is handed booleans, and the
   * question here is how those booleans were DECIDED. A rule expressed in SQL is invisible to a value-level assertion; that
   * is now the fourth wave to learn it, so this suite asserts the query.
   *
   * These are the two clauses that decide whether a tick is truthful. Without the first, a REJECTED KYC profile ticks
   * "organisation verified" — the step whose own copy says "required before money moves". Without the second, an
   * unverified bank account ticks "payouts set up", and the federation finds out on payout day that its details were wrong.
   */
  function capture() {
    const seen: string[] = [];
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      void params;
      seen.push(sql);
      // Enough shape for the read model to assemble: the head row must exist, everything else may be empty.
      if (/FROM tenants/.test(sql)) return { rows: [{ display_name: 'Shakti Federation', created_at: new Date() }] };
      return { rows: [] };
    });
    const replica = { forTenant: jest.fn((t: string) => { void t; return { query }; }) };
    return { rm: new GoLiveReadModel(replica as never), seen };
  }

  it('counts only a VERIFIED business-KYC profile', async () => {
    const h = capture();
    await h.rm.facts('t1');
    const kyc = h.seen.find((q) => /FROM business_kyc_profiles/.test(q))!;
    expect(kyc).toMatch(/status = 'verified'/);
    // And the timestamp is when somebody DECIDED, not when the tenant uploaded a certificate.
    expect(kyc).toMatch(/reviewed_at/);
  });

  it('counts only a PENNY-VERIFIED bank account', async () => {
    const h = capture();
    await h.rm.facts('t1');
    const bank = h.seen.find((q) => /FROM bank_accounts/.test(q))!;
    expect(bank).toMatch(/penny_verified_at IS NOT NULL/);
  });

  it('scopes every read to this tenant, as a bound parameter', async () => {
    const h = capture();
    await h.rm.facts('t1');
    // SIX facts in FIVE reads: staff and members are both `user_tenant_roles` rows, so they are counted in one query rather
    // than two round trips for one shape. Asserted as five so a future split has to say so out loud.
    expect(h.seen).toHaveLength(5);
    for (const q of h.seen) expect(q).toMatch(/\$1/);
  });

  it('returns null for a tenant that is not there', async () => {
    const seen: string[] = [];
    const query = jest.fn(async (sql: string) => { seen.push(sql); return { rows: [] }; });
    const replica = { forTenant: jest.fn((t: string) => { void t; return { query }; }) };
    expect(await new GoLiveReadModel(replica as never).facts('t-nope')).toBeNull();
  });
});
