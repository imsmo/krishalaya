// modules/dairy/__tests__/hotfix12-rate-card.spec.ts · PC-56 HOTFIX-12 — NO RATE CHANGE WITHOUT A SECOND PERSON AND A RECORD (unit).
// Founder Q1-A + Q1-sub (2026-11-08): every new card recorded; a second person approves it before it prices anything (the creator
// cannot); it cannot start before the tenant's today; one card in force per milk type; members told on approval (push/in-app).
// Each refusal is pinned WITH an ordering spy: refused before `idem.remember` and before any write. Live twin:
// src/__tests__/hotfix12-rate-card.integration.spec.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MilkRateCardService, dayBefore, overlapVerdict } from '../services/milk-rate-card.service';
import { MilkRateCard } from '../domain/milk-rate-card.entity';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { DairyQualityRepository } from '../repositories/dairy-quality.repository';
import { dayWithYearText, rateCardApprovedVars } from '../domain/dairy-notice-vars';
import { DairyEventType } from '../domain/dairy.events';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';

const T = 't1';
const maker = { userId: 'maker', canManage: true };
const checker = { userId: 'checker', canManage: true };
const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };

function card(o: Partial<{ id: string; effectiveFrom: string; effectiveTo: string | null; createdBy: string | null; approvedBy: string | null; approvedAt: Date | null; approvedBeforeRule: boolean; animalType: 'cow' | 'buffalo' | 'mixed' }> = {}) {
  return MilkRateCard.rehydrate({ id: o.id ?? 'c-new', tenantId: T, defaultName: 'Buffalo Dec', animalType: o.animalType ?? 'buffalo', pricingModel: 'two_axis',
    ratePerKgFatMinor: 72000n, ratePerKgSnfMinor: 34000n, baseRatePerLitreMinor: null, bonusSlabs: [],
    effectiveFrom: o.effectiveFrom ?? '2026-12-01', effectiveTo: o.effectiveTo ?? null, isActive: true,
    createdBy: o.createdBy === undefined ? 'maker' : o.createdBy, approvedBy: o.approvedBy ?? null, approvedAt: o.approvedAt ?? null,
    approvedBeforeRule: o.approvedBeforeRule ?? false });
}

/** A harness whose every collaborator records into ONE ordered log, so "refused before X" is a fact about the log. */
function harness(opts: { today?: string; pre?: MilkRateCard | null; locked?: MilkRateCard | null; meeting?: MilkRateCard[]; recipients?: string[] } = {}) {
  const log: string[] = [];
  const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { log.push(`audit:${e.action}`); }) };
  const outbox = { write: jest.fn(async (_tx: unknown, e: { eventType: string }) => { log.push(`outbox:${e.eventType}`); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => { log.push('idem'); return fn(); }) };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn({ query: jest.fn() }); }) };
  const pre = opts.pre === undefined ? card() : opts.pre;
  const repo = {
    tenantToday: jest.fn(async () => { log.push('today'); return opts.today ?? '2026-11-08'; }),
    insert: jest.fn(async () => { log.push('insert'); }),
    getById: jest.fn(async () => pre),
    getForUpdate: jest.fn(async () => (opts.locked === undefined ? pre : opts.locked)),
    approvedMeeting: jest.fn(async () => opts.meeting ?? []),
    closeOn: jest.fn(async (_tx: unknown, _t: string, id: string, to: string) => { log.push(`close:${id}:${to}`); }),
    approve: jest.fn(async () => { log.push('approve'); }),
    memberUserIdsPricedBy: jest.fn(async () => opts.recipients ?? ['f1', 'f2']),
  };
  const svc = new MilkRateCardService(uow as never, outbox as never, idem as never, metrics as never, repo as never, audit as never);
  return { svc, log, audit, outbox, idem, uow, repo };
}
const dto = (effectiveFrom: string) => ({ defaultName: 'Buffalo Dec', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom }) as never;

describe('PC-56 HOTFIX-12 · create — recorded, never backdated, prices nothing', () => {
  it('a start before the tenant\'s today → RATE_CARD_BACKDATED (422), before idem.remember and before any write', async () => {
    const h = harness({ today: '2026-11-08' });
    await expect(h.svc.create(T, maker, 'k', dto('2026-11-07'))).rejects.toMatchObject({ code: 'RATE_CARD_BACKDATED', httpStatus: 422 });
    expect(h.log).toEqual(['today']);
    expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.repo.insert).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
  });

  // Founder follow-up (2026-11-08): tomorrow at the earliest — TODAY itself is refused, so no day is ever priced by two cards.
  it('a start of TODAY → RATE_CARD_BACKDATED too, before idem.remember and before any write', async () => {
    const h = harness({ today: '2026-11-08' });
    await expect(h.svc.create(T, maker, 'k', dto('2026-11-08'))).rejects.toMatchObject({ code: 'RATE_CARD_BACKDATED', httpStatus: 422,
      message: 'A milk rate card can start tomorrow at the earliest. This card starts on 2026-11-08; today is 2026-11-08 for your organisation.' });
    expect(h.log).toEqual(['today']); expect(h.repo.insert).not.toHaveBeenCalled();
  });

  it('tomorrow is allowed; the creator is recorded; ONE audit row carries the whole card; the card awaits a second person', async () => {
    const h = harness({ today: '2026-11-08' });
    const out = await h.svc.create(T, maker, 'k', dto('2026-11-09'));
    expect(h.log).toEqual(['today', 'idem', 'uow', 'insert', 'audit:dairy.rate_card.created', `outbox:${DairyEventType.RateCardCreated}`]);
    const inserted = (h.repo.insert.mock.calls[0] as unknown[])[1] as MilkRateCard;
    expect(inserted.createdBy).toBe('maker');
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    const entry = (h.audit.write.mock.calls[0] as unknown[])[1] as { newValue: Record<string, unknown>; entityType: string };
    expect(entry.entityType).toBe('milk_rate_card');
    expect(entry.newValue).toMatchObject({ defaultName: 'Buffalo Dec', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000',
      ratePerKgSnfMinor: '34000', baseRatePerLitreMinor: null, bonusSlabs: [], effectiveFrom: '2026-11-09', effectiveTo: null, isActive: true,
      approvalState: 'awaiting_second_person', createdBy: 'maker' });
    expect(out).toMatchObject({ approvalState: 'awaiting_second_person', approvedAt: null, createdByYou: true, approvedByYou: false });
  });

  it('create never closes a predecessor — that happens at approval (an unapproved card leaves no day unpriced)', async () => {
    const h = harness();
    await h.svc.create(T, maker, 'k', dto('2026-12-01'));
    expect(h.repo.closeOn).not.toHaveBeenCalled(); expect(h.repo.approvedMeeting).not.toHaveBeenCalled();
  });

  it('no dairy.manage → refused before anything', async () => {
    const h = harness();
    await expect(h.svc.create(T, { userId: 'x', canManage: false }, 'k', dto('2026-12-01'))).rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    expect(h.log).toEqual([]);
  });
});

describe('PC-56 HOTFIX-12 · approve — a second person, one transaction', () => {
  it('the creator → 403 RATE_CARD_SECOND_PERSON_REQUIRED, before idem.remember and before any write', async () => {
    const h = harness();
    await expect(h.svc.approve(T, maker, 'k', 'c-new')).rejects.toMatchObject({ code: 'RATE_CARD_SECOND_PERSON_REQUIRED', httpStatus: 403 });
    expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.repo.approve).not.toHaveBeenCalled(); expect(h.log).toEqual([]);
  });

  it('a card with no recorded creator cannot be approved (an unknown first person is not a first person)', async () => {
    const h = harness({ pre: card({ createdBy: null }) });
    await expect(h.svc.approve(T, checker, 'k', 'c-new')).rejects.toMatchObject({ code: 'RATE_CARD_SECOND_PERSON_REQUIRED' });
    expect(h.idem.remember).not.toHaveBeenCalled();
  });

  it('a start that has already passed → RATE_CARD_BACKDATED, before idem.remember', async () => {
    const h = harness({ pre: card({ effectiveFrom: '2026-11-07' }), today: '2026-11-08' });
    await expect(h.svc.approve(T, checker, 'k', 'c-new')).rejects.toMatchObject({ code: 'RATE_CARD_BACKDATED' });
    expect(h.log).toEqual(['today']); expect(h.idem.remember).not.toHaveBeenCalled();
  });

  it('a card starting TODAY → RATE_CARD_BACKDATED at approval (tomorrow at the earliest), before idem.remember', async () => {
    const h = harness({ pre: card({ effectiveFrom: '2026-11-08' }), today: '2026-11-08' });
    await expect(h.svc.approve(T, checker, 'k', 'c-new')).rejects.toMatchObject({ code: 'RATE_CARD_BACKDATED' });
    expect(h.log).toEqual(['today']); expect(h.idem.remember).not.toHaveBeenCalled();
  });

  it('the locked re-check refuses a card that became TODAY between the pre-check and the lock (midnight crossed)', async () => {
    const h = harness({ pre: card({ effectiveFrom: '2026-11-09' }), today: '2026-11-08' });
    h.repo.tenantToday.mockImplementationOnce(async () => '2026-11-08').mockImplementationOnce(async () => '2026-11-09');
    await expect(h.svc.approve(T, checker, 'k', 'c-new')).rejects.toMatchObject({ code: 'RATE_CARD_BACKDATED' });
    expect(h.repo.approve).not.toHaveBeenCalled(); expect(h.repo.closeOn).not.toHaveBeenCalled();
  });

  it('another approved card starting the same day → 409 RATE_CARD_OVERLAP, before idem.remember', async () => {
    const h = harness({ meeting: [card({ id: 'c-twin', effectiveFrom: '2026-12-01', approvedBy: 'x', approvedAt: new Date() })] });
    await expect(h.svc.approve(T, checker, 'k', 'c-new')).rejects.toMatchObject({ code: 'RATE_CARD_OVERLAP', httpStatus: 409, details: { clashWith: ['c-twin'] } });
    expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.repo.closeOn).not.toHaveBeenCalled();
  });

  it('an already-approved card → 409 RATE_CARD_ALREADY_APPROVED inside the idempotency record (so a same-key replay answers the cached approval)', async () => {
    const approved = card({ approvedBy: 'checker', approvedAt: new Date() });
    const h = harness({ pre: approved });
    await expect(h.svc.approve(T, checker, 'k', 'c-new')).rejects.toMatchObject({ code: 'RATE_CARD_ALREADY_APPROVED', httpStatus: 409 });
    expect(h.log).toEqual(['idem', 'uow']); expect(h.repo.approve).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('a second person → predecessor closed the day before, THEN the approval, ONE audit row, the member notice; in that order', async () => {
    const pred = card({ id: 'c-old', effectiveFrom: '2026-01-01', approvedBeforeRule: true, approvedAt: new Date(), createdBy: null });
    const h = harness({ meeting: [pred], recipients: ['f1', 'f2'] });
    const out = await h.svc.approve(T, checker, 'k', 'c-new', '10.0.0.1');
    expect(h.log).toEqual(['today', 'idem', 'uow', 'today', 'close:c-old:2026-11-30', 'approve', 'audit:dairy.rate_card.approved', `outbox:${DairyEventType.RateCardApproved}`]);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    const entry = (h.audit.write.mock.calls[0] as unknown[])[1] as { newValue: Record<string, unknown>; actorUserId: string; ip: string };
    expect(entry).toMatchObject({ actorUserId: 'checker', ip: '10.0.0.1' });
    expect(entry.newValue).toMatchObject({ approvedBy: 'checker', effectiveFrom: '2026-12-01', closedPredecessors: [{ id: 'c-old', effectiveToWas: null, effectiveTo: '2026-11-30' }] });
    const ev = (h.outbox.write.mock.calls[0] as unknown[])[1] as { payload: Record<string, unknown> };
    expect(ev.payload).toMatchObject({ rateCardId: 'c-new', recipientUserIds: ['f1', 'f2'], cardName: 'Buffalo Dec', effectiveFrom: '01/12/2026', predecessorIds: ['c-old'] });
    expect(JSON.stringify(ev.payload)).not.toMatch(/72000|34000/);   // no amount in the notice
    expect(out).toMatchObject({ approvedByYou: false, createdByYou: false });
  });

  it('no member of that milk type → still ONE approval event (recipients empty), so the approval is never silent to subscribers', async () => {
    const h = harness({ recipients: [] });
    await h.svc.approve(T, checker, 'k', 'c-new');
    expect(h.outbox.write).toHaveBeenCalledTimes(1);
    expect(((h.outbox.write.mock.calls[0] as unknown[])[1] as { payload: { recipientUserIds: string[] } }).payload.recipientUserIds).toEqual([]);
  });

  it('the locked re-check refuses the creator even if the pre-check was raced', async () => {
    const h = harness({ pre: card({ createdBy: 'someone-else' }), locked: card({ createdBy: 'checker' }) });
    await expect(h.svc.approve(T, checker, 'k', 'c-new')).rejects.toMatchObject({ code: 'RATE_CARD_SECOND_PERSON_REQUIRED' });
    expect(h.repo.approve).not.toHaveBeenCalled();
  });
});

describe('PC-56 HOTFIX-12 · the pure pieces', () => {
  it('dayBefore is calendar arithmetic across a month and a year', () => {
    expect([dayBefore('2026-12-01'), dayBefore('2027-01-01'), dayBefore('2028-03-01')]).toEqual(['2026-11-30', '2026-12-31', '2028-02-29']);
  });
  it('overlapVerdict: earlier starts are predecessors; same or later starts are clashes', () => {
    expect(overlapVerdict({ effectiveFrom: '2026-12-01' }, [{ id: 'a', effectiveFrom: '2026-01-01' }, { id: 'b', effectiveFrom: '2026-12-01' }, { id: 'c', effectiveFrom: '2027-01-01' }]))
      .toEqual({ predecessors: ['a'], clashes: ['b', 'c'] });
  });
  it('a new card is born awaiting a second person; its JSON carries a state, never a person id', () => {
    const c = MilkRateCard.create({ id: 'x', tenantId: T, defaultName: 'n', animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: 1n, ratePerKgSnfMinor: 1n,
      baseRatePerLitreMinor: null, effectiveFrom: '2026-12-01', effectiveTo: null, createdBy: 'maker' });
    expect([c.isApproved, c.approvalState]).toEqual([false, 'awaiting_second_person']);
    expect(Object.keys(c.toJSON())).not.toEqual(expect.arrayContaining(['createdBy']));
    expect(JSON.stringify(c.toJSON())).not.toContain('maker');
    expect(card({ approvedBeforeRule: true, approvedAt: new Date() }).approvalState).toBe('approved_before_rule');
  });
  it('a card that ends before it starts is refused by name', () => {
    expect(() => MilkRateCard.create({ id: 'x', tenantId: T, defaultName: 'n', animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: 1n, ratePerKgSnfMinor: 1n,
      baseRatePerLitreMinor: null, effectiveFrom: '2026-12-01', effectiveTo: '2026-11-30' })).toThrow(/effectiveTo cannot be before effectiveFrom/);
  });
  it('the notice date carries its year, in digits', () => {
    expect(dayWithYearText('2026-12-01')).toBe('01/12/2026');
    expect(rateCardApprovedVars({ cardName: 'Cow Dec', effectiveFrom: '2027-01-05' })).toEqual({ cardName: 'Cow Dec', effectiveFrom: '05/01/2027' });
  });
});

describe('PC-56 HOTFIX-12 · every pricing read takes APPROVED cards only', () => {
  const replica = (rows: unknown[] = []) => { const q = jest.fn(async () => ({ rows, rowCount: rows.length })); return { q, provider: { forTenant: () => ({ query: q }) } }; };
  it('resolveActive (the pour\'s price) filters approved_at IS NOT NULL', async () => {
    const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
    await new MilkRateCardRepository(replica().provider as never).resolveActive('tA', 'cow', '2026-12-01', tx as never);
    expect(String((tx.query.mock.calls[0] as unknown[])[0])).toMatch(/is_active=true AND deleted_at IS NULL AND approved_at IS NOT NULL/);
  });
  it('the list\'s "active" means approved and active (members read it on the mobile rates page)', async () => {
    const r = replica();
    await new MilkRateCardRepository(r.provider as never).listFor('tA', { activeOnly: true });
    expect(String((r.q.mock.calls[0] as unknown[])[0])).toMatch(/is_active=true AND approved_at IS NOT NULL/);
  });
  it('the desk\'s "in force" read (quality desk, insights) has the same predicate', async () => {
    const r = replica();
    await new DairyQualityRepository(r.provider as never).cardsInForce('tA', '2026-12-01');
    expect(String((r.q.mock.calls[0] as unknown[])[0])).toMatch(/approved_at IS NOT NULL/);
  });
});

describe('PC-56 HOTFIX-12 · the member notice is wired, in three languages, push + in-app, no SMS, no amount', () => {
  const seed = readFileSync(join(__dirname, '../../../../../../db/seeds/core/0007_notification_events_templates.sql'), 'utf8');
  const rows = seed.split('\n').filter((l) => l.startsWith(" ('dairy.rate_card_approved','"));
  it('the map row exists with the list recipient key', () => {
    expect(NOTIFICATION_EVENT_MAP.filter((e) => e.outboxType === 'dairy.rate_card_approved')).toEqual([
      { outboxType: 'dairy.rate_card_approved', eventCode: 'dairy.rate_card_approved', recipientKeys: ['recipientUserIds'] }]);
  });
  it('six templates (push, inapp × en, hi, gu), no sms, above the version backfill, only the two declared variables, no figure', () => {
    const templates = rows.filter((l) => /','(push|inapp|sms|whatsapp|ivr)','/.test(l));
    expect(templates.map((l) => { const m = /^ \('dairy\.rate_card_approved','(\w+)','(\w+)'/.exec(l); return `${m?.[1]}/${m?.[2]}`; }).sort()).toEqual(['inapp/en', 'inapp/gu', 'inapp/hi', 'push/en', 'push/gu', 'push/hi']);
    expect(seed.indexOf("('dairy.rate_card_approved','push','en'")).toBeLessThan(seed.indexOf('-- NOTE (TENANT-6d-1)'));
    for (const l of templates) {
      expect([...new Set([...l.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort()).toEqual(['cardName', 'effectiveFrom']);
      expect(l).not.toMatch(/₹|\bRs\b|\d/u);
    }
  });
});
