// modules/dairy/__tests__/ops3a-pour-date.spec.ts · PC-56 OPS-3a — the first commit's money path, as UNIT pins (the live twin is
// src/__tests__/ops3a-counter.integration.spec.ts):
//   OPS3-B2 (founder Q5-A, 2026-11-08) · "Refuse a future pour date, and a pour into a period already billed for her, by name, before anything
//     is written." POUR_DATE_IN_FUTURE / POUR_WINDOW_ALREADY_BILLED, raised AFTER the permission check and BEFORE `idem.remember`, the unit of
//     work and any write — pinned with an ORDERING SPY (one shared call log), the R1a M2 lesson;
//   OPS3-B18 · no double on the reading path: the service and repository read and write the readings through core/database/pg-numeric;
//   OPS3-B14 · the counter's centre comes from the custody register, behind a read permission, fail-closed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MilkCollectionService } from '../services/milk-collection.service';
import { PourDateInFutureError, PourWindowAlreadyBilledError, DairyForbiddenError } from '../domain/dairy.errors';
import { DairyCounterCustodyReadModel } from '../read-models/dairy-counter-custody.read-model';
import { fakeNoticeVars } from '../../../../test/helpers/notice-vars';

const TODAY = '2026-11-09';
const POUR = { membershipId: 'mem-1', shift: 'morning', collectedOn: TODAY, weightKg: '10.500', fatPct: '4.10', snfPct: '8.50', waterFlag: false, adulterationFlags: [] as string[] };
const COLLECT = { userId: 'op-1', canManage: false, canCollect: true, canRead: true };

function harness(o: { today?: string; billed?: { id: string; periodStart: string; periodEnd: string } | null } = {}) {
  const calls: string[] = [];
  const rateCards = {
    tenantToday: jest.fn(async () => { calls.push('tenantToday'); return o.today ?? TODAY; }),
    resolveActive: jest.fn(async () => { calls.push('resolveActive'); return { id: 'card', hasBonusSlabs: false, priceMinor: () => 43_050n, bonusMinor: () => 0n }; }),
  };
  const repo = {
    liveBillCovering: jest.fn(async () => { calls.push('liveBillCovering'); return o.billed ?? null; }),
    insert: jest.fn(async () => { calls.push('insert'); }),
  };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => { calls.push('idem.remember'); return fn(); }) };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { calls.push('uow.run'); return fn({ query: jest.fn() }); }) };
  const outbox = { write: jest.fn(async () => { calls.push('outbox'); }) };
  const memberships = { getById: jest.fn(async () => ({ id: 'mem-1', defaultAnimalType: 'cow', farmerUserId: 'farmer-1' })) };
  const routes = { asOf: jest.fn(async () => ({ mccId: 'mcc-1' })), earliest: jest.fn(async () => null) };
  const svc = new MilkCollectionService(uow as never, outbox as never, idem as never, { inc: jest.fn(), observe: jest.fn() } as never,
    repo as never, rateCards as never, memberships as never, { priorReviews90d: jest.fn(async () => 0), insert: jest.fn() } as never,
    { isEnabled: jest.fn(async () => false) } as never, routes as never, { liveFor: jest.fn(async () => null) } as never, fakeNoticeVars());
  return { svc, calls, repo, rateCards, idem, uow, outbox };
}

describe('PC-56 OPS-3a · OPS3-B2 · the pour\'s day is bounded, by name, before anything is written', () => {
  it('a day after the organisation\'s today → POUR_DATE_IN_FUTURE (422), and NOTHING after it runs: no key record, no transaction, no row', async () => {
    const h = harness();
    const e = await h.svc.record('t1', COLLECT as never, 'k1', { ...POUR, collectedOn: '2026-11-10' } as never).catch((x) => x);
    expect(e).toBeInstanceOf(PourDateInFutureError);
    expect([e.code, e.status ?? e.httpStatus ?? e.statusCode]).toEqual(['POUR_DATE_IN_FUTURE', 422]);
    expect(e.message).toBe('A pour cannot be recorded for a day after today. This pour is dated 2026-11-10; today is 2026-11-09 for your organisation.');
    expect(h.calls).toEqual(['tenantToday']);
    expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.uow.run).not.toHaveBeenCalled(); expect(h.repo.insert).not.toHaveBeenCalled();
    expect(h.repo.liveBillCovering).not.toHaveBeenCalled();
  });
  it('"today" is the organisation\'s, asked of the database for THIS tenant — never this process\'s clock', async () => {
    const h = harness({ today: '2026-11-08' });   // the organisation's day is behind the process's: its "tomorrow" is refused
    await expect(h.svc.record('t-zone', COLLECT as never, 'k1', { ...POUR, collectedOn: TODAY } as never)).rejects.toBeInstanceOf(PourDateInFutureError);
    expect(h.rateCards.tenantToday).toHaveBeenCalledWith('t-zone');
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'milk-collection.service.ts'), 'utf8');
    const record = src.slice(src.indexOf('async record('), src.indexOf('return this.idem.remember('));
    expect(/new Date\(|Date\.now\(/.test(record)).toBe(false);
  });
  it('a day inside a LIVE bill of this member → POUR_WINDOW_ALREADY_BILLED (422), naming the bill\'s period; nothing written', async () => {
    const h = harness({ billed: { id: 'bill-1', periodStart: '2026-10-16', periodEnd: '2026-10-31' } });
    const e = await h.svc.record('t1', COLLECT as never, 'k2', { ...POUR, collectedOn: '2026-10-20' } as never).catch((x) => x);
    expect(e).toBeInstanceOf(PourWindowAlreadyBilledError);
    expect(e.code).toBe('POUR_WINDOW_ALREADY_BILLED');
    expect(e.details).toEqual({ collectedOn: '2026-10-20', billPeriodStart: '2026-10-16', billPeriodEnd: '2026-10-31' });
    expect(h.repo.liveBillCovering).toHaveBeenCalledWith('t1', 'mem-1', '2026-10-20');
    expect(h.calls).toEqual(['tenantToday', 'liveBillCovering']);
    expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.uow.run).not.toHaveBeenCalled(); expect(h.repo.insert).not.toHaveBeenCalled();
  });
  it('THE ORDERING SPY: permission → today → billed window → idem.remember → the unit of work → the insert', async () => {
    const h = harness();
    await h.svc.record('t1', COLLECT as never, 'k3', { ...POUR } as never);
    const at = (c: string) => h.calls.indexOf(c);
    expect(h.calls.slice(0, 4)).toEqual(['tenantToday', 'liveBillCovering', 'idem.remember', 'uow.run']);
    expect(at('liveBillCovering')).toBeLessThan(at('idem.remember'));
    expect(at('insert')).toBeGreaterThan(at('uow.run'));
    // the refusal source sits BEFORE the idempotency record in the file as well as in time
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'milk-collection.service.ts'), 'utf8');
    const rec = src.indexOf('async record(');
    for (const thrown of ['new PourDateInFutureError(', 'new PourWindowAlreadyBilledError(']) {
      expect([thrown, src.indexOf(thrown, rec) > rec && src.indexOf(thrown, rec) < src.indexOf('this.idem.remember(', rec)]).toEqual([thrown, true]);
    }
  });
  it('the permission check comes FIRST: a read-only actor is refused before the database is asked anything', async () => {
    const h = harness();
    await expect(h.svc.record('t1', { userId: 'r', canManage: false, canCollect: false, canRead: true } as never, 'k4', { ...POUR } as never))
      .rejects.toBeInstanceOf(DairyForbiddenError);
    expect(h.calls).toEqual([]);
  });
  it('today itself and an unbilled past day are recorded, with the server\'s price', async () => {
    for (const day of [TODAY, '2026-10-01']) {
      const h = harness();
      const out = await h.svc.record('t1', COLLECT as never, `k-${day}`, { ...POUR, collectedOn: day } as never);
      expect([day, out.collectedOn, out.amountMinor]).toEqual([day, day, '43050']);
    }
  });
});

describe('PC-56 OPS-3a · OPS3-B18 · no double on the reading path', () => {
  const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  it('the record response carries the readings as their own digits', async () => {
    const h = harness();
    const out = await h.svc.record('t1', COLLECT as never, 'k5', { ...POUR, weightKg: '12345.678', fatPct: '6.05', snfPct: '9' } as never);
    expect([out.weightKg, out.fatPct, out.snfPct]).toEqual(['12345.678', '6.05', '9.00']);
  });
  it('no `Number(`, `parseFloat`, `toFixed` or `Math.round` on the readings in the service or the repository mappers', () => {
    const svc = code('services/milk-collection.service.ts');
    expect(/Number\(|parseFloat|toFixed|Math\.round/.test(svc)).toBe(false);
    const repo = code('repositories/milk-collection.repository.ts');
    const mappers = repo.slice(0, repo.indexOf('@Injectable()'));
    expect(/Number\(|parseFloat|toFixed|Math\.round/.test(mappers)).toBe(false);
    expect(mappers).toContain('scaledFromNumeric(v, 3)'); expect(mappers).toContain('numericFromScaled(m, 3)');
  });
});

describe('PC-56 OPS-3a · OPS3-B14 · the counter\'s centre, from the custody register', () => {
  const rm = (centres: unknown[]) => {
    const repo = { inCustodyOf: jest.fn(async () => centres) };
    const cards = { tenantToday: jest.fn(async () => TODAY) };
    return { model: new DairyCounterCustodyReadModel(repo as never, cards as never), repo, cards };
  };
  it('answers the organisation\'s today and the centres whose open custody names the caller — nothing else', async () => {
    const { model, repo } = rm([{ toJSON: () => ({ id: 'mcc-1', code: 'C-01' }) }]);
    expect(await model.mine('t1', COLLECT as never)).toEqual({ today: TODAY, centres: [{ id: 'mcc-1', code: 'C-01' }] });
    expect(repo.inCustodyOf).toHaveBeenCalledWith('t1', 'op-1');
  });
  it('a person who holds no custody gets an EMPTY list (the counter then offers no form)', async () => {
    expect((await rm([]).model.mine('t1', COLLECT as never)).centres).toEqual([]);
  });
  it('fail-closed: no dairy read permission → refused before any read', async () => {
    const { model, repo, cards } = rm([]);
    await expect(model.mine('t1', { userId: 'x', canManage: false } as never)).rejects.toBeInstanceOf(DairyForbiddenError);
    expect(repo.inCustodyOf).not.toHaveBeenCalled(); expect(cards.tenantToday).not.toHaveBeenCalled();
  });
  it('the custody query reads the OPEN rows of the register (ended_at IS NULL), active centres only', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'mcc-centre.repository.ts'), 'utf8');
    const q = src.slice(src.indexOf('async inCustodyOf('), src.indexOf('async listFor('));
    expect(q).toMatch(/FROM mcc_operator_assignments[\s\S]*operator_user_id=\$2 AND ended_at IS NULL AND deleted_at IS NULL/);
    expect(q).toContain('is_active=true');
  });
});
