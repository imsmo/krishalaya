// modules/memberships/__tests__/tenant1e-share-register.read-model.spec.ts · W197's tiles (PC-56 TENANT-1e).
//
// **THIS FILE EXISTS BECAUSE TWO MUTATIONS SURVIVED.** The read model shipped with no suite of its own, so `faceValueOf`
// could stop checking that the division was exact, and the turnout could stop distinguishing "not recorded" from 0%, with
// every other test in the wave still green. Both mutants are now killed here.
import { ShareRegisterReadModel } from '../read-models/share-register.read-model';
import type { GovernanceRepository } from '../repositories/governance.repository';

type Totals = Awaited<ReturnType<GovernanceRepository['registerTotals']>>;
type Page = Awaited<ReturnType<GovernanceRepository['registerPage']>>;
type LastClosed = Awaited<ReturnType<GovernanceRepository['lastClosed']>>;

const NOW = new Date('2026-08-11T00:00:00.000Z');

function build(over: {
  totals?: Partial<Totals>; page?: Page; lastClosed?: LastClosed; settings?: Record<string, unknown>;
} = {}) {
  const calls: { pageLimit?: number; after?: unknown } = {};
  const repo = {
    bylawSettings: async () => over.settings ?? {},
    registerTotals: async (): Promise<Totals> => ({
      members: 1284, shareholders: 1212, totalShares: 12120, capitalMinor: '242400000', eligible: 1186,
      ...(over.totals ?? {}),
    }),
    registerPage: async (_tenantId: string, limit: number, after?: unknown): Promise<Page> => {
      void _tenantId;
      calls.pageLimit = limit; calls.after = after;
      return over.page ?? [];
    },
    lastClosed: async (): Promise<LastClosed> => over.lastClosed ?? null,
  } as unknown as GovernanceRepository;
  // The read model composes; the repository owns every query, so the replica is never touched here.
  const rm = new ShareRegisterReadModel({ forTenant: () => { throw new Error('the read model must not query directly'); } } as never, repo);
  return { rm, calls };
}

const row = (over: Partial<Page[number]> = {}): Page[number] => ({
  userId: '11111111-1111-4111-8111-111111111111', fullName: 'Ramesh P.', phone: '+919876543210',
  sharesHeld: 40, valueMinor: '800000', memberSince: '2019-04-01T00:00:00.000Z', suspended: false, ...over,
});

describe('TENANT-1e · the face value is derived, and refused when it cannot be', () => {
  it('divides exactly: 12,120 shares of ₹24,24,000 capital is ₹200 a share', async () => {
    const { rm } = build();
    const v = await rm.view('t1', undefined, NOW);
    expect(v.tiles.faceValueMinor).toBe('20000');
  });

  it('a register issued at more than one price yields NO face value — the mutant that survived', async () => {
    // 12,119 shares against the same capital does not divide. Rounding would print a number on the legal document that
    // the legal document contradicts.
    const { rm } = build({ totals: { totalShares: 12119 } });
    expect((await rm.view('t1', undefined, NOW)).tiles.faceValueMinor).toBeNull();
  });

  it('no shares at all yields no face value rather than a division by zero', async () => {
    const { rm } = build({ totals: { totalShares: 0, capitalMinor: '0' } });
    expect((await rm.view('t1', undefined, NOW)).tiles.faceValueMinor).toBeNull();
  });

  it('a capital beyond 2^53 paise still divides exactly (Law 2 — bigint, not float)', async () => {
    // 15,000 tenants at scale: ₹90,00,00,00,00,000 is past what a double can hold in paise.
    const { rm } = build({ totals: { capitalMinor: '90000000000000000', totalShares: 4_500_000 } });
    expect((await rm.view('t1', undefined, NOW)).tiles.faceValueMinor).toBe('20000000000');
  });

  it('a non-numeric capital yields null rather than NaN', async () => {
    const { rm } = build({ totals: { capitalMinor: 'not-a-number' } });
    expect((await rm.view('t1', undefined, NOW)).tiles.faceValueMinor).toBeNull();
  });
});

describe('TENANT-1e · the turnout tile keeps unknown separate from zero', () => {
  it('a resolution closed with no recorded roll reports turnout null — the second mutant that survived', async () => {
    const { rm } = build({ lastClosed: { id: 'r1', title: 'AGM 2024', closedAt: null, cast: 618, eligibleAtClose: null } });
    const t = (await rm.view('t1', undefined, NOW)).tiles.lastAgm;
    expect(t?.cast).toBe(618);          // the numerator survived
    expect(t?.eligible).toBeNull();     // the denominator did not
    expect(t?.turnoutBp).toBeNull();    // so there is no turnout, and 0% would be a lie about 618 people
  });

  it('a recorded roll of zero also yields null — dividing by it is not a turnout', async () => {
    const { rm } = build({ lastClosed: { id: 'r1', title: 'AGM', closedAt: null, cast: 0, eligibleAtClose: 0 } });
    expect((await rm.view('t1', undefined, NOW)).tiles.lastAgm?.turnoutBp).toBeNull();
  });

  it('a recorded roll gives the canon’s 52%', async () => {
    const { rm } = build({ lastClosed: { id: 'r1', title: 'AGM 2025', closedAt: '2025-09-01T00:00:00.000Z', cast: 618, eligibleAtClose: 1186 } });
    expect((await rm.view('t1', undefined, NOW)).tiles.lastAgm?.turnoutBp).toBe(5210);
  });

  it('no closed resolution at all leaves the tile empty rather than zeroed', async () => {
    const { rm } = build();
    expect((await rm.view('t1', undefined, NOW)).tiles.lastAgm).toBeNull();
  });
});

describe('TENANT-1e · the tiles', () => {
  it('pending allotment is members minus shareholders — W197’s 72', async () => {
    const { rm } = build();
    expect((await rm.view('t1', undefined, NOW)).tiles.pendingAllotment).toBe(72);
  });

  it('pending allotment never goes negative, even on inconsistent counts', async () => {
    const { rm } = build({ totals: { members: 10, shareholders: 12 } });
    expect((await rm.view('t1', undefined, NOW)).tiles.pendingAllotment).toBe(0);
  });

  it('eligible-of-shareholders is null with no shareholders, never 0%', async () => {
    const { rm } = build({ totals: { shareholders: 0, eligible: 0 } });
    expect((await rm.view('t1', undefined, NOW)).tiles.eligibleOfShareholdersBp).toBeNull();
  });

  it('eligible-of-shareholders matches W197’s 98%', async () => {
    const { rm } = build();
    expect((await rm.view('t1', undefined, NOW)).tiles.eligibleOfShareholdersBp).toBe(9785);
  });
});

describe('TENANT-1e · every row carries a verdict from the same rule the vote path uses', () => {
  it('an eligible shareholder', async () => {
    const { rm } = build({ page: [row()] });
    const v = await rm.view('t1', undefined, NOW);
    expect(v.rows[0].verdict.eligible).toBe(true);
  });

  it('a suspended member is shown as suspended, not as short of shares', async () => {
    const { rm } = build({ page: [row({ suspended: true })] });
    expect((await rm.view('t1', undefined, NOW)).rows[0].verdict.reason).toBe('suspended');
  });

  it('a member inside the tenure rule carries the DATE they become eligible', async () => {
    const { rm } = build({ page: [row({ sharesHeld: 10, memberSince: '2026-05-14T00:00:00.000Z' })] });
    const v = (await rm.view('t1', undefined, NOW)).rows[0].verdict;
    expect(v.reason).toBe('too_new');
    expect(v.eligibleFrom).toBe('2026-11-14T00:00:00.000Z');
  });

  it('the tenant’s own bylaws decide, not a literal', async () => {
    const { rm } = build({ page: [row({ sharesHeld: 20 })], settings: { 'governance.min_shares_to_vote': '25' } });
    const v = await rm.view('t1', undefined, NOW);
    expect(v.bylaws.minShares).toBe(25);
    expect(v.rows[0].verdict.reason).toBe('too_few_shares');
    expect(v.rows[0].verdict.sharesShort).toBe(5);
  });

  it('the phone is masked — a register read is not a reveal (TENANT-1b)', async () => {
    const { rm } = build({ page: [row()] });
    const p = (await rm.view('t1', undefined, NOW)).rows[0].phoneMasked;
    // W197 draws it as "+91 98••• ••210"; the shared helper masks the middle with asterisks. What matters is that the
    // subscriber number cannot be read off the register: seeing that a member exists and being able to telephone them are
    // different acts, and the second one goes through `member.pii.reveal` on the member page.
    expect(p).not.toContain('9876543210');
    expect(p).toContain('*');
    expect(p).toBe('+9198****3210');
  });

  it('a member with no phone on file shows nothing rather than a masked blank', async () => {
    const { rm } = build({ page: [row({ phone: null })] });
    expect((await rm.view('t1', undefined, NOW)).rows[0].phoneMasked).toBeNull();
  });
});

describe('TENANT-1e · the keyset page', () => {
  it('asks for one row more than the page, which is how the next-page flag is answered', async () => {
    const { rm, calls } = build({ page: [] });
    await rm.view('t1', undefined, NOW);
    expect(calls.pageLimit).toBe(26);
  });

  it('reports no next cursor when the extra row did not come back', async () => {
    const page = Array.from({ length: 25 }, (_v, i) => row({ userId: `1111111${i}-1111-4111-8111-111111111111`.slice(0, 36) }));
    const { rm } = build({ page });
    const v = await rm.view('t1', undefined, NOW);
    expect(v.rows).toHaveLength(25);
    expect(v.nextCursor).toBeNull();
  });

  it('emits a cursor from the LAST row of the page when there is more', async () => {
    const page = Array.from({ length: 26 }, (_v, i) => row({
      userId: `2222222${(i % 10)}-2222-4222-8222-22222222222${i % 10}`, sharesHeld: 100 - i,
    }));
    const { rm } = build({ page });
    const v = await rm.view('t1', undefined, NOW);
    expect(v.rows).toHaveLength(25);            // the probe row is not shown
    expect(v.nextCursor).toBe(`${v.rows[24].sharesHeld}:${v.rows[24].userId}`);
  });

  it('a malformed cursor shows page one rather than an error — a truncated URL is not a failure', async () => {
    for (const bad of ['', 'garbage', ':', '10:not-a-uuid', '-1:11111111-1111-4111-8111-111111111111', 'x:11111111-1111-4111-8111-111111111111']) {
      const { rm, calls } = build({ page: [] });
      await rm.view('t1', bad, NOW);
      expect(calls.after).toBeUndefined();
    }
  });

  it('a well-formed cursor is passed through as a keyset, not as an offset', async () => {
    const { rm, calls } = build({ page: [] });
    await rm.view('t1', '40:11111111-1111-4111-8111-111111111111', NOW);
    expect(calls.after).toEqual({ shares: 40, userId: '11111111-1111-4111-8111-111111111111' });
  });
});
