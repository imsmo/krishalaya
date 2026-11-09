// modules/dairy/__tests__/ops3b-custody.spec.ts · PC-56 OPS-3b · L1 (lead decision 2026-11-09, from OPS-3a §2) — CUSTODY, AT THE API, as UNIT
// pins (the live twin is src/__tests__/ops3b-tank.integration.spec.ts). A caller who holds dairy.collect (or dairy.read) but NOT dairy.manage:
//   • records a pour only for a member of a centre in their OPEN custody — refused DAIRY_CENTRE_NOT_IN_CUSTODY (403) BEFORE the day checks,
//     `idem.remember`, the unit of work and any write (an ORDERING SPY, the R1a M2 lesson);
//   • records a manual cooler reading only for a cooler at such a centre — refused before the one write (`appendForOwner`);
//   • lists the roll only for such a centre; `box=mcc` with no centre and `box=all` are NARROWED to their custody centres.
// dairy.manage holders are unchanged: no custody is asked of them at all.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MilkCollectionService } from '../services/milk-collection.service';
import { BmcReadingService } from '../services/bmc-reading.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { DairyCentreNotInCustodyError } from '../domain/dairy.errors';
import { fakeNoticeVars } from '../../../../test/helpers/notice-vars';

const TODAY = '2026-11-09';
const POUR = { membershipId: 'mem-1', shift: 'morning', collectedOn: TODAY, weightKg: '10.500', fatPct: '4.10', snfPct: '8.50', waterFlag: false, adulterationFlags: [] as string[] };
const COLLECT = { userId: 'op-1', canManage: false, canCollect: true, canRead: true };
const READER = { userId: 'rd-1', canManage: false, canCollect: false, canRead: true };
const MANAGE = { userId: 'adm-1', canManage: true, canCollect: true, canRead: true };

function pourHarness(held: string[], home = 'mcc-1') {
  const calls: string[] = [];
  const rateCards = {
    tenantToday: jest.fn(async () => { calls.push('tenantToday'); return TODAY; }),
    resolveActive: jest.fn(async () => ({ id: 'card', hasBonusSlabs: false, priceMinor: () => 43_050n, bonusMinor: () => 0n })),
  };
  const repo = {
    liveBillCovering: jest.fn(async () => { calls.push('liveBillCovering'); return null; }),
    insert: jest.fn(async () => { calls.push('insert'); }),
  };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => { calls.push('idem.remember'); return fn(); }) };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { calls.push('uow.run'); return fn({ query: jest.fn() }); }) };
  const outbox = { write: jest.fn(async () => { calls.push('outbox'); }) };
  const memberships = {
    getById: jest.fn(async () => { calls.push('membership'); return { id: 'mem-1', defaultAnimalType: 'cow', farmerUserId: 'farmer-1', toProps: () => ({ mccId: home }) }; }),
    custodyCentreIds: jest.fn(async () => { calls.push('custody'); return held; }),
  };
  const routes = { asOf: jest.fn(async () => ({ mccId: home })), earliest: jest.fn(async () => null) };
  const svc = new MilkCollectionService(uow as never, outbox as never, idem as never, { inc: jest.fn(), observe: jest.fn() } as never,
    repo as never, rateCards as never, memberships as never, { priorReviews90d: jest.fn(async () => 0), insert: jest.fn() } as never,
    { isEnabled: jest.fn(async () => false) } as never, routes as never, { liveFor: jest.fn(async () => null) } as never, fakeNoticeVars());
  return { svc, calls, repo, idem, uow, memberships };
}

describe('PC-56 OPS-3b · L1 · a pour, only for a member of a centre in your custody', () => {
  it('a member of a centre you do not hold → DAIRY_CENTRE_NOT_IN_CUSTODY (403), and NOTHING after it runs', async () => {
    const h = pourHarness(['mcc-2']);
    const e = await h.svc.record('t1', COLLECT as never, 'k1', { ...POUR } as never).catch((x) => x);
    expect(e).toBeInstanceOf(DairyCentreNotInCustodyError);
    expect([e.code, e.httpStatus, e.details]).toEqual(['DAIRY_CENTRE_NOT_IN_CUSTODY', 403, { mccId: 'mcc-1' }]);
    expect(h.calls).toEqual(['membership', 'custody']);
    expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.uow.run).not.toHaveBeenCalled(); expect(h.repo.insert).not.toHaveBeenCalled();
    expect(h.repo.liveBillCovering).not.toHaveBeenCalled();   // the stranger learns nothing about her bills
  });
  it('a member of your centre, but the pour NAMES a centre you do not hold → refused the same way, naming that centre', async () => {
    const h = pourHarness(['mcc-1']);
    const e = await h.svc.record('t1', COLLECT as never, 'k2', { ...POUR, mccId: 'mcc-9' } as never).catch((x) => x);
    expect([e.code, e.details]).toEqual(['DAIRY_CENTRE_NOT_IN_CUSTODY', { mccId: 'mcc-9' }]);
    expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.uow.run).not.toHaveBeenCalled();
  });
  it('holding no centre at all → refused', async () => {
    const h = pourHarness([]);
    await expect(h.svc.record('t1', COLLECT as never, 'k3', { ...POUR } as never)).rejects.toBeInstanceOf(DairyCentreNotInCustodyError);
  });
  it('THE ORDERING SPY: permission → custody → today → billed window → idem.remember → the unit of work → the insert', async () => {
    const h = pourHarness(['mcc-1']);
    await h.svc.record('t1', COLLECT as never, 'k4', { ...POUR, mccId: 'mcc-1' } as never);
    expect(h.calls.slice(0, 6)).toEqual(['membership', 'custody', 'tenantToday', 'liveBillCovering', 'idem.remember', 'uow.run']);
    expect(h.calls.indexOf('insert')).toBeGreaterThan(h.calls.indexOf('uow.run'));
    // and in the file: the custody check is called before the first day check and before `this.idem.remember(`
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'milk-collection.service.ts'), 'utf8');
    const rec = src.indexOf('async record(');
    const at = src.indexOf('await this.assertPourCustody(', rec);
    expect(at > rec && at < src.indexOf('this.rateCards.tenantToday(', rec) && at < src.indexOf('this.idem.remember(', rec)).toBe(true);
  });
  it('a dairy.manage holder is NOT custody-bound: no custody is asked, and a member of any centre is recorded', async () => {
    const h = pourHarness([]);
    const out = await h.svc.record('t1', MANAGE as never, 'k5', { ...POUR, mccId: 'mcc-1' } as never);
    expect(out.amountMinor).toBe('43050');
    expect(h.memberships.custodyCentreIds).not.toHaveBeenCalled();
  });
});

describe('PC-56 OPS-3b · L1 · a manual cooler reading, only for a cooler at a centre in your custody', () => {
  const harness = (held: string[]) => {
    const calls: string[] = [];
    const unit = { toProps: () => ({ id: 'u1', mccId: 'mcc-1', isActive: true, minDeci: 0, targetDeci: 40, toleranceDeci: 5, iotDeviceRef: null }) };
    const units = {
      byId: jest.fn(async () => unit), byDeviceRef: jest.fn(async () => unit),
      custodyCentreIds: jest.fn(async () => { calls.push('custody'); return held; }),
    };
    const appendForOwner = jest.fn(async () => { calls.push('appendForOwner'); return { id: 'r1', band: { minC: 0, maxC: 4.5 }, isBreach: false, recordedAt: new Date('2026-11-09T05:00:00Z') }; });
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const svc = new BmcReadingService(uow as never, { inc: jest.fn(), observe: jest.fn() } as never, units as never, { appendForOwner } as never);
    return { svc, calls, units, appendForOwner };
  };
  it('a cooler at a centre you do not hold → DAIRY_CENTRE_NOT_IN_CUSTODY (403), nothing written', async () => {
    const h = harness(['mcc-2']);
    const e = await h.svc.record('t1', COLLECT as never, { unitId: 'u1', tempC: '3.8' }).catch((x) => x);
    expect([e.code, e.httpStatus, e.details]).toEqual(['DAIRY_CENTRE_NOT_IN_CUSTODY', 403, { mccId: 'mcc-1' }]);
    expect(h.appendForOwner).not.toHaveBeenCalled();
  });
  it('the same by a sensor reference', async () => {
    const h = harness([]);
    await expect(h.svc.record('t1', COLLECT as never, { deviceRef: 'dev-1', tempC: '3.8' })).rejects.toBeInstanceOf(DairyCentreNotInCustodyError);
    expect(h.appendForOwner).not.toHaveBeenCalled();
  });
  it('a cooler at your centre → recorded; custody is checked BEFORE the write', async () => {
    const h = harness(['mcc-1']);
    const r = await h.svc.record('t1', COLLECT as never, { unitId: 'u1', tempC: '3.8' });
    expect([r.tempC, r.verdict]).toEqual(['3.8', 'in_range']);
    expect(h.calls).toEqual(['custody', 'appendForOwner']);
  });
  it('a dairy.manage holder is NOT custody-bound', async () => {
    const h = harness([]);
    await h.svc.record('t1', MANAGE as never, { unitId: 'u1', tempC: '3.8' });
    expect(h.units.custodyCentreIds).not.toHaveBeenCalled(); expect(h.appendForOwner).toHaveBeenCalledTimes(1);
  });
});

describe('PC-56 OPS-3b · L1 · the roll follows custody', () => {
  const harness = (held: string[]) => {
    const repo = { custodyCentreIds: jest.fn(async () => held), listFor: jest.fn(async () => []) };
    const svc = new DairyMembershipService({} as never, {} as never, {} as never, {} as never, repo as never, {} as never, {} as never);
    return { svc, repo };
  };
  for (const [who, actor] of [['collect', COLLECT], ['read', READER]] as const) {
    it(`${who}-only: box=mcc&mccId= a centre you do not hold → DAIRY_CENTRE_NOT_IN_CUSTODY, nothing listed`, async () => {
      const h = harness(['mcc-1']);
      const e = await h.svc.list('t1', actor as never, { box: 'mcc', mccId: 'mcc-2', limit: 50 }).catch((x) => x);
      expect([e.code, e.details]).toEqual(['DAIRY_CENTRE_NOT_IN_CUSTODY', { mccId: 'mcc-2' }]);
      expect(h.repo.listFor).not.toHaveBeenCalled();
    });
    it(`${who}-only: your centre → listed for that centre`, async () => {
      const h = harness(['mcc-1']);
      await h.svc.list('t1', actor as never, { box: 'mcc', mccId: 'mcc-1', limit: 50 });
      expect(h.repo.listFor).toHaveBeenCalledWith('t1', expect.objectContaining({ mccId: 'mcc-1', mccIds: undefined }));
    });
    it(`${who}-only: box=mcc with NO centre, and box=all → NARROWED to your custody centres (none → an empty roll)`, async () => {
      for (const box of ['mcc', 'all'] as const) {
        const h = harness(['mcc-1', 'mcc-3']);
        await h.svc.list('t1', actor as never, { box, limit: 50 });
        expect(h.repo.listFor).toHaveBeenCalledWith('t1', expect.objectContaining({ mccId: undefined, mccIds: ['mcc-1', 'mcc-3'] }));
        const none = harness([]);
        await none.svc.list('t1', actor as never, { box, limit: 50 });
        expect(none.repo.listFor).toHaveBeenCalledWith('t1', expect.objectContaining({ mccIds: [] }));
      }
    });
  }
  it('dairy.manage: any centre, and box=all is the whole organisation (no custody asked)', async () => {
    const h = harness([]);
    await h.svc.list('t1', MANAGE as never, { box: 'mcc', mccId: 'mcc-2', limit: 50 });
    await h.svc.list('t1', MANAGE as never, { box: 'all', limit: 50 });
    expect(h.repo.custodyCentreIds).not.toHaveBeenCalled();
    expect(h.repo.listFor.mock.calls.map((c) => (c as unknown as [string, { mccIds?: string[] }])[1].mccIds)).toEqual([undefined, undefined]);
  });
  it('box=mine (a member\'s own) asks no custody', async () => {
    const h = harness([]);
    await h.svc.list('t1', { userId: 'f1', canManage: false } as never, { box: 'mine', limit: 50 });
    expect(h.repo.custodyCentreIds).not.toHaveBeenCalled();
  });
  it('an EMPTY narrowing list is an empty roll in SQL (ANY of an empty array), never "every centre"', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'dairy-membership.repository.ts'), 'utf8');
    expect(src).toContain('if (q.mccIds) where += ` AND mcc_id = ANY(');
    const q = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'dairy-custody.sql.ts'), 'utf8');
    expect(q).toMatch(/FROM mcc_operator_assignments a[\s\S]*a\.operator_user_id = \$2 AND a\.ended_at IS NULL AND a\.deleted_at IS NULL/);
    expect(q).toContain('c.is_active = true');
  });
});
