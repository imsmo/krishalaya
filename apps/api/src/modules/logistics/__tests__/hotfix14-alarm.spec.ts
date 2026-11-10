// modules/logistics/__tests__/hotfix14-alarm.spec.ts · PC-56 HOTFIX-14 · NOBODY SILENCES THE ALARM ALONE (OPS-5 Q3-A, lead-applied 2026-11-10).
// Pure + service-level (no database):
//   • the quieter/louder classifier as a TABLE — every field, both directions, a mixed change, the neutral fields;
//   • every refusal BY NAME and its ORDER: after the permission check, BEFORE `idem.remember` (E12) — pinned with a spy;
//   • a quieter edit writes a PROPOSAL (never the rule); a louder edit writes the rule; both write an audit row with before/after + reason;
//   • a NEW rule always applies at once (a create is never a proposal);
//   • the cooler monitor's "who would be told" counts ACTIVE rules only (F-2).
// The live half (the database guard, the CHECK, 202/200 over HTTP, no_recipient after two people agree) is hotfix14-alarm.integration.
import { classifyRuleChange, type AlertRuleState } from '../domain/ops-alert.rules';
import { OpsAlertService } from '../services/ops-alert.service';
import { DairyBmcReadModel } from '../../dairy/read-models/dairy-bmc.read-model';

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';
const C = '00000000-0000-7000-8000-00000000000c';
const st = (over: Partial<AlertRuleState> = {}): AlertRuleState => ({
  ruleName: 'Reefer breaches', threshold: { windowHours: 6, minBreaches: 2 }, recipientUserIds: [A, B], channelHint: null, cooldownMinutes: 60, isActive: true, ...over,
});

describe('HOTFIX-14 · the classifier — which way does each field move the alarm?', () => {
  type Row = [string, 'cold_chain_breach' | 'device_silent' | 'maintenance_due', Partial<AlertRuleState>, Partial<AlertRuleState>, 'apply' | 'propose', Array<[string, string]>];
  const T: Row[] = [
    ['pause',                        'cold_chain_breach', {}, { isActive: false }, 'propose', [['isActive', 'quieter']]],
    ['resume',                       'cold_chain_breach', { isActive: false }, { isActive: true }, 'apply', [['isActive', 'louder']]],
    ['remove a person',              'cold_chain_breach', {}, { recipientUserIds: [A] }, 'propose', [['recipientsRemoved', 'quieter']]],
    ['add a person',                 'cold_chain_breach', {}, { recipientUserIds: [A, B, C] }, 'apply', [['recipientsAdded', 'louder']]],
    ['swap a person (mixed)',        'cold_chain_breach', {}, { recipientUserIds: [A, C] }, 'propose', [['recipientsRemoved', 'quieter'], ['recipientsAdded', 'louder']]],
    ['reorder people only',          'cold_chain_breach', {}, { recipientUserIds: [B, A] }, 'apply', []],
    ['longer cooldown',              'cold_chain_breach', {}, { cooldownMinutes: 1440 }, 'propose', [['cooldownMinutes', 'quieter']]],
    ['shorter cooldown',             'cold_chain_breach', {}, { cooldownMinutes: 5 }, 'apply', [['cooldownMinutes', 'louder']]],
    ['minBreaches raised',           'cold_chain_breach', {}, { threshold: { windowHours: 6, minBreaches: 1000 } }, 'propose', [['minBreaches', 'quieter']]],
    ['minBreaches lowered',          'cold_chain_breach', {}, { threshold: { windowHours: 6, minBreaches: 1 } }, 'apply', [['minBreaches', 'louder']]],
    ['window NARROWED (quieter)',    'cold_chain_breach', {}, { threshold: { windowHours: 1, minBreaches: 2 } }, 'propose', [['windowHours', 'quieter']]],
    ['window WIDENED (louder)',      'cold_chain_breach', {}, { threshold: { windowHours: 168, minBreaches: 2 } }, 'apply', [['windowHours', 'louder']]],
    ['a key dropped → default 6 h',  'cold_chain_breach', { threshold: { windowHours: 24, minBreaches: 2 } }, { threshold: { minBreaches: 2 } }, 'propose', [['windowHours', 'quieter']]],
    ['subjectType filter added',     'cold_chain_breach', {}, { threshold: { windowHours: 6, minBreaches: 2, subjectType: 'shipment' } }, 'propose', [['subjectType', 'quieter']]],
    ['subjectType filter changed',   'cold_chain_breach', { threshold: { subjectType: 'shipment' } }, { threshold: { subjectType: 'bmc_unit' } }, 'propose', [['subjectType', 'quieter']]],
    ['subjectType filter removed',   'cold_chain_breach', { threshold: { subjectType: 'shipment' } }, { threshold: {} }, 'apply', [['subjectType', 'louder']]],
    ['silence longer',               'device_silent', { threshold: { silentMinutes: 15 } }, { threshold: { silentMinutes: 43200 } }, 'propose', [['silentMinutes', 'quieter']]],
    ['silence shorter',              'device_silent', { threshold: { silentMinutes: 60 } }, { threshold: { silentMinutes: 15 } }, 'apply', [['silentMinutes', 'louder']]],
    ['legacy hours → same minutes',  'device_silent', { threshold: { silentHours: 1 } }, { threshold: { silentMinutes: 60 } }, 'apply', []],
    ['legacy hours longer',          'device_silent', { threshold: { silentMinutes: 60 } }, { threshold: { silentHours: 2 } }, 'propose', [['silentMinutes', 'quieter']]],
    ['maintenance any → one flag',   'maintenance_due', { threshold: { alert: 'any' } }, { threshold: { alert: 'service_due' } }, 'propose', [['alert', 'quieter']]],
    ['maintenance flag → the other', 'maintenance_due', { threshold: { alert: 'service_due' } }, { threshold: { alert: 'needs_attention' } }, 'propose', [['alert', 'quieter']]],
    ['maintenance flag → any',       'maintenance_due', { threshold: { alert: 'needs_attention' } }, { threshold: {} }, 'apply', [['alert', 'louder']]],
    ['rename (neutral)',             'cold_chain_breach', {}, { ruleName: 'Van breaches' }, 'apply', [['ruleName', 'neutral']]],
    ['channel hint cleared (neutral)', 'cold_chain_breach', { channelHint: 'sms' }, { channelHint: null }, 'apply', [['channelHint', 'neutral']]],
    ['louder + quieter at once (mixed) → a proposal as a whole', 'cold_chain_breach', {}, { recipientUserIds: [A, B, C], cooldownMinutes: 600 }, 'propose', [['recipientsAdded', 'louder'], ['cooldownMinutes', 'quieter']]],
    ['resume + raise the threshold (mixed)', 'cold_chain_breach', { isActive: false }, { isActive: true, threshold: { windowHours: 6, minBreaches: 50 } }, 'propose', [['isActive', 'louder'], ['minBreaches', 'quieter']]],
    ['no change at all',             'cold_chain_breach', {}, {}, 'apply', []],
  ];
  it.each(T)('%s', (_n, kind, b, a, verdict, changes) => {
    const r = classifyRuleChange(kind, st(b), st({ ...b, ...a }));
    expect(r.verdict).toBe(verdict);
    expect(r.changes.map((c) => [c.field, c.direction]).sort()).toEqual([...changes].sort());
  });
});

/* ───────────────────────────── the service, with spies ───────────────────────────── */
const RULE = { id: 'r-1', kind: 'cold_chain_breach', ruleName: 'Reefer breaches', threshold: { windowHours: 6, minBreaches: 2 }, recipientUserIds: [A, B], channelHint: null, cooldownMinutes: 60, isActive: true, lastEvaluatedAt: null };
function harness(over: { rule?: unknown; open?: unknown; change?: unknown; outsiders?: string[] } = {}) {
  const order: string[] = [];
  const rule = 'rule' in over ? over.rule : RULE;
  const repo = {
    findRule: jest.fn(async () => rule),
    openChangeFor: jest.fn(async () => over.open ?? null),
    findChange: jest.fn(async () => over.change ?? null),
    nonMembers: jest.fn(async () => over.outsiders ?? []),
    insertRule: jest.fn(async () => { order.push('insertRule'); return { ok: true }; }),
    updateRule: jest.fn(async () => { order.push('updateRule'); return true; }),
    insertChange: jest.fn(async () => { order.push('insertChange'); }),
    confirmChange: jest.fn(async () => { order.push('confirmChange'); return true; }),
    withdrawChange: jest.fn(async () => { order.push('withdrawChange'); return true; }),
  };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => Promise<unknown>) => { order.push('remember'); return fn(); }) };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
  const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { order.push(`audit:${e.action}`); }) };
  const svc = new OpsAlertService(uow as never, { write: jest.fn() } as never, repo as never, idem as never, audit as never);
  return { svc, repo, idem, audit, order };
}
const ME = { userId: A, canManage: true };
const OTHER = { userId: B, canManage: true };
const WHY = 'Cooler sent away for repair';
const change = (over: Record<string, unknown> = {}) => ({ id: 'c-1', ruleId: 'r-1', state: 'proposed', before: { ruleName: RULE.ruleName, threshold: RULE.threshold, recipientUserIds: RULE.recipientUserIds, channelHint: null, cooldownMinutes: 60, isActive: true },
  after: { ruleName: RULE.ruleName, threshold: RULE.threshold, recipientUserIds: RULE.recipientUserIds, channelHint: null, cooldownMinutes: 60, isActive: false }, reason: WHY, proposedBy: A, proposedAt: '2026-11-10T00:00:00.000Z', confirmedBy: null, confirmedAt: null, withdrawnAt: null, ...over });

describe('HOTFIX-14 · every refusal BY NAME, before the idempotency record (E12)', () => {
  const refused = async (p: Promise<unknown>, code: string, h: ReturnType<typeof harness>) => {
    await expect(p).rejects.toMatchObject({ code });
    expect(h.idem.remember).not.toHaveBeenCalled();
    expect(h.order).toEqual([]);
  };
  /** A refusal that depends on STATE a first call writes (still open, rule unmoved) is judged on the locked rows INSIDE the idempotency
   *  record — so a retried request replays its own answer (the HOTFIX-13 precedent) — and still before ANY write. */
  const refusedInside = async (p: Promise<unknown>, code: string, h: ReturnType<typeof harness>) => {
    await expect(p).rejects.toMatchObject({ code });
    expect(h.order).toEqual(['remember']);
  };
  it('the permission check is first (no logistics.manage → 403 before anything is read)', async () => {
    const h = harness();
    await expect(h.svc.updateRule('t', { userId: A, canManage: false }, 'k', 'r-1', { isActive: false, reason: WHY })).rejects.toMatchObject({ httpStatus: 403 });
    expect(h.repo.findRule).not.toHaveBeenCalled(); expect(h.idem.remember).not.toHaveBeenCalled();
  });
  it('edit: REASON_REQUIRED (none, or under 10 characters trimmed)', async () => {
    const h = harness();
    await refused(h.svc.updateRule('t', ME, 'k', 'r-1', { isActive: false }), 'REASON_REQUIRED', h);
    await refused(h.svc.updateRule('t', ME, 'k', 'r-1', { isActive: false, reason: '  too short ' }), 'REASON_REQUIRED', h);
  });
  it('edit: a rule found BY ID — absent → not found (F-11: never via the 200-row list)', async () => {
    const h = harness({ rule: null });
    await expect(h.svc.updateRule('t', ME, 'k', 'r-9', { cooldownMinutes: 30, reason: WHY })).rejects.toMatchObject({ httpStatus: 404 });
    expect(h.repo.findRule).toHaveBeenCalledWith('t', 'r-9'); expect(h.idem.remember).not.toHaveBeenCalled();
  });
  it('edit: ALERT_RULE_CHANGE_ALREADY_OPEN (a second quieter proposal on one rule)', async () => {
    const h = harness({ open: change() });
    await refusedInside(h.svc.updateRule('t', ME, 'k', 'r-1', { cooldownMinutes: 600, reason: WHY }), 'ALERT_RULE_CHANGE_ALREADY_OPEN', h);
  });
  it('edit and create: ALERT_RECIPIENT_NOT_MEMBER (F-10)', async () => {
    const h = harness({ outsiders: [C] });
    await refused(h.svc.updateRule('t', ME, 'k', 'r-1', { recipientUserIds: [A, B, C], reason: WHY }), 'ALERT_RECIPIENT_NOT_MEMBER', h);
    await refused(h.svc.createRule('t', ME, 'k', { kind: 'cold_chain_breach', ruleName: 'New rule', recipientUserIds: [C], reason: WHY }), 'ALERT_RECIPIENT_NOT_MEMBER', h);
  });
  it('create: REASON_REQUIRED', async () => {
    const h = harness();
    await refused(h.svc.createRule('t', ME, 'k', { kind: 'cold_chain_breach', ruleName: 'New rule', recipientUserIds: [A] }), 'REASON_REQUIRED', h);
  });
  it('confirm: ALERT_RULE_CONFIRMER_IS_PROPOSER (403) and ALERT_RULE_CHANGE_NOT_FOUND before the record; NOT_OPEN and CHANGED_SINCE_PROPOSAL on the locked rows, before any write', async () => {
    let h = harness({ change: change() });
    await refused(h.svc.confirmChange('t', ME, 'k', 'c-1'), 'ALERT_RULE_CONFIRMER_IS_PROPOSER', h);
    h = harness({ change: change({ state: 'confirmed', confirmedBy: B }) });
    await refusedInside(h.svc.confirmChange('t', OTHER, 'k', 'c-1'), 'ALERT_RULE_CHANGE_NOT_OPEN', h);
    h = harness({ change: change(), rule: { ...RULE, cooldownMinutes: 30 } });
    await refusedInside(h.svc.confirmChange('t', OTHER, 'k', 'c-1'), 'ALERT_RULE_CHANGED_SINCE_PROPOSAL', h);
    h = harness({ change: null });
    await refused(h.svc.confirmChange('t', OTHER, 'k', 'c-x'), 'ALERT_RULE_CHANGE_NOT_FOUND', h);
  });
  it('withdraw: ALERT_RULE_WITHDRAW_NOT_PROPOSER, ALERT_RULE_CHANGE_NOT_OPEN', async () => {
    let h = harness({ change: change() });
    await refused(h.svc.withdrawChange('t', OTHER, 'k', 'c-1'), 'ALERT_RULE_WITHDRAW_NOT_PROPOSER', h);
    h = harness({ change: change({ state: 'withdrawn', withdrawnAt: '2026-11-10T01:00:00.000Z' }) });
    await refusedInside(h.svc.withdrawChange('t', ME, 'k', 'c-1'), 'ALERT_RULE_CHANGE_NOT_OPEN', h);
  });
});

describe('HOTFIX-14 · what each act writes, in order', () => {
  it('a QUIETER edit (pause) writes a PROPOSAL and its audit row — never the rule', async () => {
    const h = harness();
    const r = await h.svc.updateRule('t', ME, 'k', 'r-1', { isActive: false, reason: WHY });
    expect(r).toMatchObject({ status: 'proposed', id: 'r-1' });
    expect(h.order).toEqual(['remember', 'insertChange', 'audit:logistics.alert_rule_change_proposed']);
    expect(h.repo.updateRule).not.toHaveBeenCalled();
    const [, entry] = h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>];
    expect(entry).toMatchObject({ actorUserId: A, entityId: 'r-1', reason: WHY, oldValue: { isActive: true }, newValue: { isActive: false } });
  });
  it('a LOUDER edit (add a person) writes the RULE and its audit row with before/after and the reason', async () => {
    const h = harness();
    const r = await h.svc.updateRule('t', ME, 'k', 'r-1', { recipientUserIds: [A, B, C], reason: WHY });
    expect(r).toMatchObject({ status: 'applied' });
    expect(h.order).toEqual(['remember', 'updateRule', 'audit:logistics.alert_rule_updated']);
    const [, , , next, by] = h.repo.updateRule.mock.calls[0] as unknown as [unknown, string, string, AlertRuleState, string];
    expect(next.recipientUserIds).toEqual([A, B, C]); expect(by).toBe(A);
    const [, entry] = h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>];
    expect(entry).toMatchObject({ reason: WHY, oldValue: { recipientUserIds: [A, B] }, newValue: { recipientUserIds: [A, B, C] } });
  });
  it('F-11: `channelHint: null` CLEARS the hint (the whole state is written, never COALESCE)', async () => {
    const h = harness({ rule: { ...RULE, channelHint: 'sms' } });
    await h.svc.updateRule('t', ME, 'k', 'r-1', { channelHint: null, reason: WHY });
    expect((h.repo.updateRule.mock.calls[0] as unknown as [unknown, string, string, AlertRuleState])[3].channelHint).toBeNull();
  });
  it('a NEW rule always applies at once (never a proposal), with its author and an audit row', async () => {
    const h = harness();
    const r = await h.svc.createRule('t', ME, 'k', { kind: 'cold_chain_breach', ruleName: 'New rule', recipientUserIds: [A], reason: WHY });
    expect(r).toMatchObject({ status: 'applied' });
    expect(h.order).toEqual(['remember', 'insertRule', 'audit:logistics.alert_rule_created']);
    expect(h.repo.insertChange).not.toHaveBeenCalled();
    expect((h.repo.insertRule.mock.calls[0] as unknown as [unknown, { by: string }])[1].by).toBe(A);
  });
  it('a confirmation by ANOTHER person: the change confirmed, the rule becomes `after`, one audit row naming the proposer', async () => {
    const h = harness({ change: change() });
    const r = await h.svc.confirmChange('t', OTHER, 'k', 'c-1');
    expect(r).toEqual({ id: 'c-1', ruleId: 'r-1', state: 'confirmed' });
    expect(h.order).toEqual(['remember', 'confirmChange', 'updateRule', 'audit:logistics.alert_rule_change_confirmed']);
    expect((h.repo.updateRule.mock.calls[0] as unknown as [unknown, string, string, AlertRuleState, string])[3].isActive).toBe(false);
    expect((h.repo.updateRule.mock.calls[0] as unknown as [unknown, string, string, AlertRuleState, string])[4]).toBe(B);
    const [, entry] = h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, any>];
    expect(entry).toMatchObject({ actorUserId: B, reason: WHY, newValue: { proposedBy: A } });
  });
  it('the proposer withdraws: the rule is never written', async () => {
    const h = harness({ change: change() });
    await h.svc.withdrawChange('t', ME, 'k', 'c-1');
    expect(h.order).toEqual(['remember', 'withdrawChange', 'audit:logistics.alert_rule_change_withdrawn']);
    expect(h.repo.updateRule).not.toHaveBeenCalled();
  });
});

describe('HOTFIX-14 · F-2 · the cooler monitor counts ACTIVE rules only', () => {
  it('a paused breach rule\'s people are not "who would be told"', async () => {
    const active = { kind: 'cold_chain_breach', isActive: true, threshold: {}, recipientUserIds: [A] };
    const paused = { kind: 'cold_chain_breach', isActive: false, threshold: {}, recipientUserIds: [B, C] };
    // the real repository's filter, simulated: `activeOnly` returns the active rules only
    const alerts = { listRules: jest.fn(async (_t: string, q: { activeOnly?: boolean } = {}) => (q.activeOnly ? [active] : [active, paused])) };
    const replica = { forTenant: () => ({ query: jest.fn(async (sql: string) => (sql.includes('SELECT now()') ? { rows: [{ n: new Date('2026-11-10T00:00:00Z') }] } : { rows: [{ ev: 1, sms: 3, crit_ev: 1, crit_ivr: 3 }] })) }) };
    const units = { monitor: jest.fn(async () => []), thresholds: jest.fn(async () => ({ divertDeci: 75, condemnDeci: 80, silenceMinutes: 15 })),
      windowCounts: jest.fn(async () => ({ readings: 0, breaches: 0, units: 0 })), series: jest.fn(async () => []) };
    const rm = new DairyBmcReadModel(replica as never, units as never, alerts as never, { isEnabled: jest.fn(async () => true) } as never, { inc: jest.fn(), observe: jest.fn() } as never);
    const v = await rm.view('t1', { userId: 'desk', canManage: true } as never, {});
    expect(alerts.listRules).toHaveBeenCalledWith('t1', { activeOnly: true });
    expect(v.alerting.breachRules).toBe(1);
    expect(v.alerting.recipients).toBe(1);
  });
});
