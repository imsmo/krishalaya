// modules/logistics/__tests__/ops5a-alerts.spec.ts · PC-56 OPS-5a · THE ALERTS — the first commit (no migration), service-level and source:
//   • OPS5-B3 (survey F-4): the feed's acknowledge is KEYED and RECORDED; a breach's or a silence's own alert (rule_id NULL) is refused
//     ALERT_ACK_ON_ITS_OWN_FILE (409), BEFORE the idempotency record (E12, a spy) and with the row untouched; the SQL itself acknowledges a
//     rule's alert only;
//   • OPS5-B4 (survey F-3): the cold_chain_breach rule groups by the SUBJECT and labels its alert by the server's short reference — never a
//     typed `device_ref`; its body says it counts readings "from the logger or typed by a person"; the cooldown bucket is per subject id;
//   • OPS5-B6 (survey F-7, maintenance half): maintenance_due judges the ORGANISATION's day, never CURRENT_DATE;
//   • E6: "run the rules now" writes one audit row naming the person; the route calls it;
//   • W402's last change: when, and whether it was the reader — never an id on the wire.
// The live half (over HTTP, real Postgres) is src/__tests__/ops5a-alerts.integration.spec.ts.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OpsAlertService } from '../services/ops-alert.service';
import { subjectShortRef } from '../domain/logistics-ops';

const REPO_SRC = fs.readFileSync(path.join(__dirname, '../repositories/ops-alert.repository.ts'), 'utf8');
const SVC_SRC = fs.readFileSync(path.join(__dirname, '../services/ops-alert.service.ts'), 'utf8');
const CTRL_SRC = fs.readFileSync(path.join(__dirname, '../controllers/v1/routes.controller.ts'), 'utf8');
const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from) + from.length));
/** The first template literal (the SQL) of a slice. */
const sqlOf = (q: string) => q.slice(q.indexOf('`'), q.indexOf('`', q.indexOf('`') + 1) + 1);
const A = '00000000-0000-7000-8000-00000000000a';

function harness(fired: unknown, ackOk = true) {
  const order: string[] = [];
  const repo = {
    findFired: jest.fn(async () => fired),
    acknowledge: jest.fn(async () => { order.push('acknowledge'); return ackOk; }),
  };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => Promise<unknown>) => { order.push('remember'); return fn(); }) };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
  const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { order.push(`audit:${e.action}`); }) };
  const svc = new OpsAlertService(uow as never, { write: jest.fn() } as never, repo as never, idem as never, audit as never);
  return { svc, repo, idem, audit, order };
}
const actor = { userId: A, canManage: true, ip: '127.0.0.1' };

describe('OPS-5a · OPS5-B3 · the acknowledge is keyed and recorded; a breach\'s or silence\'s alert is refused on its own file', () => {
  it('a RULE\'s alert: remember → acknowledge → one audit row naming the person', async () => {
    const h = harness({ id: 'f-1', ruleId: 'r-1', kind: 'cold_chain_breach', acknowledgedAt: null });
    await expect(h.svc.acknowledge('t1', actor, 'key-1', 'f-1')).resolves.toEqual({ id: 'f-1', acknowledged: true });
    expect(h.order).toEqual(['remember', 'acknowledge', 'audit:logistics.alert_acknowledged']);
    expect(h.idem.remember).toHaveBeenCalledWith('key-1', A, 'logistics.alert_acknowledge', expect.any(Function));
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({ tenantId: 't1', actorUserId: A, entityType: 'ops_fired_alert', entityId: 'f-1', newValue: { acknowledged: true, ruleId: 'r-1' } });
  });
  it.each([['cold_chain_breach'], ['device_silent']])('a %s\'s OWN alert (rule_id NULL) → ALERT_ACK_ON_ITS_OWN_FILE (409), before the idempotency record; nothing written', async (kind) => {
    const h = harness({ id: 'f-2', ruleId: null, kind, acknowledgedAt: null });
    await expect(h.svc.acknowledge('t1', actor, 'key-2', 'f-2')).rejects.toMatchObject({ code: 'ALERT_ACK_ON_ITS_OWN_FILE', httpStatus: 409 });
    expect(h.idem.remember).not.toHaveBeenCalled();
    expect(h.repo.acknowledge).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
  });
  it('an unknown alert → 404 before the record; an already-acknowledged one → 409 inside it, no audit row', async () => {
    const none = harness(null);
    await expect(none.svc.acknowledge('t1', actor, 'k', 'f-x')).rejects.toMatchObject({ httpStatus: 404 });
    expect(none.idem.remember).not.toHaveBeenCalled();
    const twice = harness({ id: 'f-3', ruleId: 'r-1', kind: 'device_silent', acknowledgedAt: null }, false);
    await expect(twice.svc.acknowledge('t1', actor, 'k', 'f-3')).rejects.toMatchObject({ httpStatus: 409 });
    expect(twice.audit.write).not.toHaveBeenCalled();
  });
  it('without logistics.manage → 403 before anything is read', async () => {
    const h = harness({ id: 'f-1', ruleId: 'r-1', kind: 'x', acknowledgedAt: null });
    await expect(h.svc.acknowledge('t1', { ...actor, canManage: false }, 'k', 'f-1')).rejects.toMatchObject({ httpStatus: 403 });
    expect(h.repo.findFired).not.toHaveBeenCalled();
  });
  it('source: the SQL acknowledges a rule\'s alert only; the route takes an Idempotency-Key and refuses a non-uuid', () => {
    const ack = between(REPO_SRC, 'async acknowledge(', 'async lastChanges(');
    expect(ack).toContain('rule_id IS NOT NULL');
    const route = between(CTRL_SRC, "@Post('alerts/:id/acknowledge')", '@Post(\'alert-rules/evaluate\')');
    expect(route).toMatch(/@Headers\('idempotency-key'\) key: string/);
    expect(route).toMatch(/this\.alerts\.acknowledge\(ctx\.tenantId, this\.alertActor\(ctx, r\), reqKey\(key\), id\)/);
    expect(route).toContain('UUID_RE.test(id)');
  });
});

describe('OPS-5a · OPS5-B4 · the breach rule names the SUBJECT, never a typed label', () => {
  const S1 = '0192d2c4-c001-7000-8000-000000000c01';
  it('evidence: subjectRef = the server\'s short reference; the body says what is counted; the cooldown bucket is per subject id', async () => {
    const repo = {
      activeRulesForTenant: jest.fn(async () => [{ id: 'r-1', kind: 'cold_chain_breach', ruleName: 'breach', threshold: { windowHours: 6, minBreaches: 2 }, recipientUserIds: [A], channelHint: null, cooldownMinutes: 60 }]),
      coldChainBreachCounts: jest.fn(async () => [{ subjectType: 'bmc_unit', subjectId: S1, breaches: 3, lastTempC: '9.50', lastAt: '2026-11-10T02:00:00.000Z', deviceRef: 'Ramesh cooler sensor' }]),
      recordFired: jest.fn(async () => true),
      touchEvaluated: jest.fn(async () => undefined),
    };
    const outbox = { write: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    await new OpsAlertService(uow as never, outbox as never, repo as never, {} as never, {} as never).evaluateTenant('t1');
    const [, ev] = outbox.write.mock.calls[0] as unknown as [unknown, { payload: Record<string, any> }];   // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(subjectShortRef(S1)).toBe('0192D2C4');
    expect(ev.payload.subjectRef).toBe('0192D2C4');
    expect(ev.payload.body).toBe('3 out-of-band reading(s), from the logger or typed by a person, in the last 6h on bmc_unit 0192D2C4 (last 9.50°C).');
    expect(JSON.stringify(ev.payload)).not.toContain('Ramesh');
    const fired = (repo.recordFired.mock.calls[0] as unknown as [unknown, { subjectRef: string; dedupeKey: string }])[1];
    expect(fired.subjectRef).toBe('0192D2C4');
    expect(fired.dedupeKey.startsWith(`r-1:${S1}:`)).toBe(true);
  });
  it('source: the evidence query groups by subject only and never reads device_ref', () => {
    const q = between(REPO_SRC, 'async coldChainBreachCounts', 'async silentDevices');
    const sql = sqlOf(q);
    expect(sql).toContain('GROUP BY subject_type, subject_id ORDER BY');
    expect(/device_ref/.test(sql)).toBe(false);
    expect(/deviceRef/.test(between(SVC_SRC, 'private async evidenceFor', "if (rule.kind === 'device_silent')"))).toBe(false);
  });
});

describe('OPS-5a · OPS5-B6 · maintenance_due on the organisation\'s day', () => {
  it('source: the day is `tenants.country_code → countries.timezone`; CURRENT_DATE is gone', () => {
    const q = between(REPO_SRC, 'async maintenanceAlerts', '// ===== fired log =====');
    expect(q).toContain('(now() AT TIME ZONE co.timezone)::date AS today FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id=$1');
    expect((q.match(/d\.today - 365/g) ?? []).length).toBe(2);
    expect(/CURRENT_DATE|current_date/.test(sqlOf(q))).toBe(false);
  });
});

describe('OPS-5a · E6 · "run the rules now" is recorded', () => {
  it('evaluateNow → one audit row naming the person with what it evaluated, fired and suppressed', async () => {
    const audit = { write: jest.fn(async () => undefined) };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const repo = { activeRulesForTenant: jest.fn(async () => []) };
    const out = await new OpsAlertService(uow as never, { write: jest.fn() } as never, repo as never, {} as never, audit as never).evaluateNow('t1', actor);
    expect(out).toEqual({ evaluated: 0, fired: 0, suppressed: 0 });
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect((audit.write.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]).toMatchObject({ tenantId: 't1', actorUserId: A, action: 'logistics.alert_rules_evaluated_now', newValue: out });
  });
  it('without logistics.manage → 403, nothing evaluated; the route calls evaluateNow (never evaluateTenant directly)', async () => {
    const repo = { activeRulesForTenant: jest.fn(async () => []) };
    await expect(new OpsAlertService({} as never, {} as never, repo as never, {} as never, {} as never).evaluateNow('t1', { ...actor, canManage: false })).rejects.toMatchObject({ httpStatus: 403 });
    expect(repo.activeRulesForTenant).not.toHaveBeenCalled();
    const route = between(CTRL_SRC, "@Post('alert-rules/evaluate')", "@Get('devices')");
    expect(route).toContain('this.alerts.evaluateNow(ctx.tenantId, this.alertActor(ctx, r))');
    expect(route).not.toContain('evaluateTenant');
  });
});

describe('OPS-5a · W402\'s last change — when, and whether it was you; never an id', () => {
  it('rules(): lastChange carries the action, the time and byYou — not the actor', async () => {
    const repo = {
      listRules: jest.fn(async () => [{ id: 'r-1', kind: 'cold_chain_breach' }, { id: 'r-2', kind: 'device_silent' }]),
      openChanges: jest.fn(async () => []),
      lastChanges: jest.fn(async () => new Map([['r-1', { action: 'logistics.alert_rule_change_confirmed', at: '2026-11-10T03:00:00.000Z', actorUserId: A }]])),
    };
    const out = await new OpsAlertService({} as never, {} as never, repo as never, {} as never, {} as never).rules('t1', actor, {}) as Array<Record<string, unknown>>;
    expect(out[0].lastChange).toEqual({ action: 'change_confirmed', at: '2026-11-10T03:00:00.000Z', byYou: true });
    expect(out[1].lastChange).toBeNull();
    expect(JSON.stringify(out[0].lastChange)).not.toContain(A);
    const other = await new OpsAlertService({} as never, {} as never, repo as never, {} as never, {} as never).rules('t1', { ...actor, userId: 'someone-else' }, {}) as Array<Record<string, unknown>>;
    expect((other[0].lastChange as { byYou: boolean }).byYou).toBe(false);
  });
  it('source: the last change is read from audit_log (made, changed, a proposal confirmed) — not updated_at', () => {
    const q = between(REPO_SRC, 'async lastChanges', '\n  }\n');
    expect(q).toContain("FROM audit_log");
    expect(q).toContain("action IN ('logistics.alert_rule_created', 'logistics.alert_rule_updated', 'logistics.alert_rule_change_confirmed')");
    expect(/updated_at/.test(sqlOf(q))).toBe(false);
  });
});
