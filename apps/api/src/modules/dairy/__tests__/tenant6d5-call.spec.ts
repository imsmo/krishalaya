// modules/dairy/__tests__/tenant6d5-call.spec.ts · PC-56 TENANT-6d-5 · the call, and the fifteen minutes.
//
// W170 makes four promises about reaching a human. What is asserted here is each one, and each of the four defects that
// stood between the sentence and a phone ringing:
//
//   • **FIFTEEN MINUTES WAS NOT A NUMBER THIS PLATFORM COULD HOLD.** `device_silent` validated `silentHours` 1..720 and
//     floored the measured gap to whole hours, so a fifteen-minute silence was `0` — below every legal threshold — and
//     the alert body would have read *"has not reported for ~0h"* if one had ever fired.
//   • **THE ALERTING COULD NOT NAME THE VOICE CHANNEL.** `channel_hint` allowed five of the spine's six channels, and
//     the missing one was the channel *"operator called"* is about.
//   • **A CRITICAL ALERT AT 2AM REACHED NOBODY.** Quiet hours suppress push, SMS, WhatsApp and voice unless the
//     CATALOGUE event is `critical`; every ops alert was catalogued `important`, and severity lives on the fired alert.
//   • **A CALL ABOUT A TANK HAD NOWHERE TO BE FILED.** `CONTEXT_TYPES` had no entry for a cooler, so a privacy-proxy
//     call about MCC-AND-03 would have been logged against nothing.
//
// And the act itself: refused when nobody holds the centre, refused when the caller IS the holder, never carrying a
// phone number, never claiming a call it did not place, and re-taking its verdict at the moment it acts rather than
// trusting the confirm screen it came from.
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ALERT_EVALUATION_MINUTES, DEFAULT_SILENT_MINUTES, OPS_ALERT_CRITICAL_OUTBOX_TYPE, OPS_ALERT_OUTBOX_TYPE,
  defaultsFor, outboxTypeFor, severityFor, silenceText, silentMinutesOf, validateThreshold,
} from '../../logistics/domain/ops-alert.rules';
import { NOTIFICATION_EVENT_MAP } from '../../communication/events/notification-event-map';
import { OpsAlertService } from '../../logistics/services/ops-alert.service';
import { DairyBmcReadModel } from '../read-models/dairy-bmc.read-model';
import { CONTEXT_TYPES, MULTI_THREAD_CONTEXT_TYPES } from '../../communication/domain/messaging.events';
import {
  BMC_CALL_REFUSALS, MAX_CALL_REASON, MIN_CALL_REASON, callObject, callVerdict, gapRetryIsAPageLoad,
} from '../domain/bmc-call';
import { BMC_CALL_FLAG } from '../domain/bmc-call.flags';
import { CallBmcOperatorSchema, PreviewBmcCallSchema } from '../dto/bmc.dto';
import { BmcController } from '../controllers/v1/bmc.controller';
import { BmcCallService } from '../services/bmc-call.service';
import { BmcCallRefusedError } from '../domain/dairy.errors';
import { telemetryVerdict } from '../domain/bmc';

const NOW = new Date('2026-08-21T14:18:00Z');
const UNIT = { id: 'u-1', mccId: 'c-1', mccCode: 'MCC-AND-03', mccName: 'Keshod', isActive: true };
const HOLDER = { operatorUserId: 'raju', operatorName: 'Raju Patel', assignedAt: '2026-06-01T05:00:00Z' };

const verdict = (over: Record<string, unknown> = {}) => callVerdict({
  canManage: true, actorUserId: 'desk', unit: UNIT, custody: HOLDER, reason: 'tank at 6.9 and rising', ...over,
} as never);

const mig = () => fs.readFileSync(
  path.join(__dirname, '../../../../../../db/migrations/0165_ops_alert_minutes_and_the_call.sql'), 'utf8');
const seed = () => fs.readFileSync(
  path.join(__dirname, '../../../../../../db/seeds/core/0007_notification_events_templates.sql'), 'utf8');

describe('PC-56 TENANT-6d-5 · the fifteen minutes', () => {
  it('holds a threshold in MINUTES, which is what W170 asks for', () => {
    expect(validateThreshold('device_silent', { silentMinutes: 15 })).toEqual({ ok: true });
    // The number the canon names, and the one that was unreachable: `silentHours` could not go below 1.
    expect(validateThreshold('device_silent', { silentHours: 1 })).toEqual({ ok: true });
    expect(validateThreshold('device_silent', { silentMinutes: 1 })).toEqual({ ok: true });
    expect(validateThreshold('device_silent', { silentMinutes: 43200 })).toEqual({ ok: true });
    expect(validateThreshold('device_silent', { silentMinutes: 43201 }).ok).toBe(false);
    expect(validateThreshold('device_silent', { silentMinutes: 0 }).ok).toBe(false);
    expect(validateThreshold('device_silent', { silentMinutes: 15.5 }).ok).toBe(false);
  });

  it('refuses a rule that carries BOTH units, rather than picking one', () => {
    // Two thresholds on one rule is a rule whose meaning depends on which line of code reads it.
    expect(validateThreshold('device_silent', { silentMinutes: 15, silentHours: 12 }).ok).toBe(false);
    expect(validateThreshold('device_silent', { silentHrs: 12 }).ok).toBe(false);   // the classic typo, still refused
  });

  it('reads either unit through ONE function, so two readers cannot disagree', () => {
    expect(silentMinutesOf({ silentMinutes: 15 })).toBe(15);
    // The legacy key, converted rather than ignored: 0165 could only migrate the rows that existed when it ran.
    // NOT twelve hours: 12 * 60 is exactly `DEFAULT_SILENT_MINUTES`, so an implementation that DROPPED the legacy key
    // entirely would pass such an assertion by coincidence. The mutation pass found that; this is the fix.
    expect(silentMinutesOf({ silentHours: 1 })).toBe(60);
    expect(silentMinutesOf({ silentHours: 3 })).toBe(180);
    expect(silentMinutesOf({ silentHours: 12 })).toBe(720);
    expect(silentMinutesOf({})).toBe(DEFAULT_SILENT_MINUTES);
    expect(silentMinutesOf(null)).toBe(DEFAULT_SILENT_MINUTES);
    // A malformed threshold falls back to the default instead of becoming zero — a zero would fire on every device.
    expect(silentMinutesOf({ silentMinutes: 'soon' } as never)).toBe(DEFAULT_SILENT_MINUTES);
    expect(silentMinutesOf({ silentMinutes: -5 })).toBe(DEFAULT_SILENT_MINUTES);
    expect(silentMinutesOf({ silentHours: 0 })).toBe(DEFAULT_SILENT_MINUTES);
    // The default means the same twelve hours it always meant.
    expect(defaultsFor('device_silent')).toEqual({ silentMinutes: 720 });
    expect(validateThreshold('device_silent', defaultsFor('device_silent'))).toEqual({ ok: true });
  });

  it('says a gap out loud instead of flooring it to ~0h', () => {
    // The message a village operator would have received about a fifteen-minute silence.
    expect(silenceText(15)).toBe('15 min');
    expect(silenceText(0)).toBe('0 min');
    expect(silenceText(59)).toBe('59 min');
    expect(silenceText(60)).toBe('1h');
    expect(silenceText(190)).toBe('3h 10m');
    expect(silenceText(2 * 1440)).toBe('2 days');
    expect(silenceText(1439)).toBe('23h 59m');
    // No float and no negative: a sensor with a wrong clock reads as nothing, not as minus three minutes.
    expect(silenceText(-5)).toBe('0 min');
    expect(silenceText(15.9)).toBe('15 min');
  });

  it('escalates by evidence in the new unit, and keeps the same two-day meaning', () => {
    expect(severityFor('device_silent', { silentMinutes: 15 })).toBe('warning');
    expect(severityFor('device_silent', { silentMinutes: 48 * 60 })).toBe('critical');
    expect(severityFor('device_silent', { silentMinutes: 48 * 60 - 1 })).toBe('warning');
  });

  it('asks the database about the RULE\'s threshold, not about a default', () => {
    // The mutation pass found this uncovered at unit level: hardcoding 720 here fires on the wrong evidence for every
    // cooperative whose rule says something else, and the screen would still report the rule as active.
    const repo = {
      activeRulesForTenant: jest.fn(async () => [{
        id: 'r-1', kind: 'device_silent', ruleName: 'silence 15', threshold: { silentMinutes: 15 },
        recipientUserIds: ['op-1'], channelHint: 'ivr', cooldownMinutes: 5,
      }]),
      silentDevices: jest.fn(async () => [{ deviceRef: 'dev-1', lastSeen: '2026-08-21T14:00:00Z', silentMinutes: 20 }]),
      recordFired: jest.fn(async () => true),
      touchEvaluated: jest.fn(async () => undefined),
    };
    const outbox = { write: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const svc = new OpsAlertService(uow as never, outbox as never, repo as never);
    return svc.evaluateTenant('t1').then(() => {
      expect(repo.silentDevices).toHaveBeenCalledWith('t1', 15);
      const [, ev] = outbox.write.mock.calls[0] as unknown as [unknown, Record<string, any>];
      // And the body says the gap in minutes, with the threshold it was judged against beside it.
      expect(ev.payload.body).toContain('20 min');
      expect(ev.payload.detail).toMatchObject({ silentMinutes: 20, thresholdMinutes: 15 });
      expect(ev.eventType).toBe(OPS_ALERT_OUTBOX_TYPE);
    });
  });

  it('states the evaluator cadence ONCE, where the screen and the job both read it', () => {
    // A monitor that printed "checked every 10 minutes" from its own literal would keep printing it after the job's
    // factory changed. The factory reads the same constant.
    expect(ALERT_EVALUATION_MINUTES).toBe(10);
    const mod = fs.readFileSync(path.join(__dirname, '../../logistics/logistics.module.ts'), 'utf8');
    expect(mod).toContain('new OpsAlertsCadenceJob(ALERT_EVALUATION_INTERVAL_MS');
    expect(mod).not.toContain('new OpsAlertsCadenceJob(10 * 60_000');
  });

  it('measures the gap in minutes in the SQL, not in hours', () => {
    const repo = fs.readFileSync(path.join(__dirname, '../../logistics/repositories/ops-alert.repository.ts'), 'utf8');
    const q = repo.slice(repo.indexOf('async silentDevices'), repo.indexOf('async maintenanceAlerts'));
    expect(q).toContain("/ 60)::int AS silent_minutes");
    expect(q).toContain("($2 || ' minutes')::interval");
    // The floored-hours arithmetic is GONE, not merely unused — this is the line that made 15 minutes unreachable.
    expect(q).not.toContain('/ 3600');
    expect(q).not.toContain("' hours')::interval");
  });
});

describe('PC-56 TENANT-6d-5 · a critical alert may wake somebody', () => {
  it('carries a critical verdict on its OWN outbox type', () => {
    expect(outboxTypeFor('critical')).toBe(OPS_ALERT_CRITICAL_OUTBOX_TYPE);
    expect(outboxTypeFor('warning')).toBe(OPS_ALERT_OUTBOX_TYPE);
    expect(outboxTypeFor('info')).toBe(OPS_ALERT_OUTBOX_TYPE);
    // A maintenance reminder must NOT reach the unmutable path.
    expect(outboxTypeFor(severityFor('maintenance_due', { alert: 'service_due' }))).toBe(OPS_ALERT_OUTBOX_TYPE);
    expect(outboxTypeFor(severityFor('cold_chain_breach', { breaches: 5 }))).toBe(OPS_ALERT_CRITICAL_OUTBOX_TYPE);
  });

  it('maps that type to a catalogued event, or it would fan out to nobody', () => {
    // ADMIN-6b's lesson: a map row pointing at nothing looks fixed and changes nothing — and so does an emitter with no
    // map row. Both halves are asserted.
    const row = NOTIFICATION_EVENT_MAP.find((e) => e.outboxType === OPS_ALERT_CRITICAL_OUTBOX_TYPE);
    expect(row).toBeDefined();
    expect(row?.eventCode).toBe('ops.alert_critical');
    expect(row?.recipientKeys).toEqual(['recipientUserIds']);
    const svc = fs.readFileSync(path.join(__dirname, '../../logistics/services/ops-alert.service.ts'), 'utf8');
    expect(svc).toContain('eventType: outboxTypeFor(hit.severity)');
  });

  it('catalogues it as CRITICAL and unmutable, which is the whole point', () => {
    const m = mig();
    const stmt = m.slice(m.indexOf("INSERT INTO notification_events"), m.indexOf('165.4'));
    expect(stmt).toContain("'ops.alert_critical'");
    // `critical` is what bypasses quiet hours in `resolveChannels`; `false` is what stops it being muted.
    expect(stmt).toContain("'critical'");
    expect(stmt).toContain('false, false)');
    expect(stmt).toContain('"push","sms","ivr"');
  });

  it('gives the voice leg copy in all three languages, ABOVE the version backfill', () => {
    const s = seed();
    for (const ch of ['push', 'sms', 'ivr']) {
      for (const l of ['en', 'hi', 'gu']) {
        expect({ ch, l, has: s.includes(`('ops.alert_critical','${ch}','${l}'`) }).toEqual({ ch, l, has: true });
      }
    }
    // THE ORDER IS THE DEFECT TENANT-6d-1 HIT: anything added after 0122's version backfill ships with
    // `serving_version_id = NULL`, resolves to nothing, and is recorded as `no_template` — silently.
    expect(s.indexOf("'ops.alert_critical','ivr','gu'"))
      .toBeLessThan(s.indexOf('INSERT INTO notification_template_versions ('));
    // And the ORDINARY alert does not gain a voice leg: an alert that phones somebody for a warning is the alert that
    // gets muted, and muting is how the critical one stops being heard too.
    expect(s).not.toContain("('ops.alert_fired','ivr'");
  });

  it('lets a rule NAME the voice channel at last', () => {
    const m = mig();
    const check = m.slice(m.indexOf('ADD CONSTRAINT ops_alert_rules_channel_hint_check'), m.indexOf('COMMENT ON COLUMN ops_alert_rules.channel_hint'));
    expect(check).toContain("'ivr'");
    for (const ch of ['push', 'sms', 'whatsapp', 'email', 'inapp']) expect(check).toContain(`'${ch}'`);
    expect(check).toContain('IS NULL');   // still optional — a hint, never a requirement
  });

  it('migrates the rows that exist rather than leaving two units in the table', () => {
    const m = mig();
    const upd = m.slice(m.indexOf('UPDATE ops_alert_rules'), m.indexOf('165.3'));
    expect(upd).toContain("'silentMinutes', ((threshold->>'silentHours')::int * 60)");
    expect(upd).toContain("kind = 'device_silent'");
    expect(upd).toContain("threshold ? 'silentHours'");
    expect(upd).toContain("NOT (threshold ? 'silentMinutes')");
    // A malformed row is left alone rather than coerced — the reader falls back to the default and the rule stays
    // visible as itself instead of being silently rewritten.
    expect(upd).toContain("~ '^[0-9]+$'");
  });
});

describe('PC-56 TENANT-6d-5 · the call', () => {
  it('files a call against the COOLER it was about', () => {
    // A privacy-proxy call log with a NULL context cannot answer "who was called about this cooler, and when" — which
    // is most of what a call log is for. Added in the module that owns the vocabulary, not written as a literal.
    expect(CONTEXT_TYPES).toContain('bmc_unit');
    // Every value that existed still does: this is a widening, not a replacement.
    for (const v of ['order', 'requirement', 'dispute', 'booking', 'direct', 'support_ticket', 'listing']) {
      expect(CONTEXT_TYPES).toContain(v);
    }
    // A tank has ONE thread, not one per caller the way a listing has one per buyer.
    expect(MULTI_THREAD_CONTEXT_TYPES.has('bmc_unit')).toBe(false);
    expect(PreviewBmcCallSchema.safeParse({ unitId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }).success).toBe(true);
  });

  it('allows the call when a tank, a holder and a reason are all present', () => {
    const v = verdict();
    expect(v).toEqual({ allowed: true, refusals: [], calleeUserId: 'raju' });
  });

  it('names NO callee on a refused verdict, even when somebody does hold the centre', () => {
    // The dangerous shape: custody exists, so a naive implementation returns its holder — and a confirm screen names a
    // person the act will not call. Refusal first, callee never.
    for (const o of [{ reason: '' }, { canManage: false }, { unit: { ...UNIT, isActive: false } }, { actorUserId: 'raju' }]) {
      const v = verdict(o);
      expect({ o, allowed: v.allowed, callee: v.calleeUserId }).toEqual({ o, allowed: false, callee: null });
    }
  });

  it('REFUSES a call to a centre nobody holds — and names that as the bigger problem', () => {
    const v = verdict({ custody: null });
    expect(v.refusals).toEqual(['NOBODY_HOLDS_CENTRE']);
    // No callee, ever, on a refused verdict: a confirm screen must not name a person the act will not call.
    expect(v.calleeUserId).toBeNull();
  });

  it('REFUSES to bridge somebody to their own phone', () => {
    expect(verdict({ actorUserId: 'raju' }).refusals).toEqual(['CALLING_YOURSELF']);
  });

  it('REQUIRES a reason, because the audit row is the promise', () => {
    expect(verdict({ reason: '' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(verdict({ reason: '   ' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(verdict({ reason: 'ok' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(verdict({ reason: 'x'.repeat(MAX_CALL_REASON) }).allowed).toBe(true);
    expect(verdict({ reason: 'x'.repeat(MAX_CALL_REASON + 1) }).refusals).toEqual(['REASON_TOO_LONG']);
    expect(MIN_CALL_REASON).toBe(3);
    // The edge's bounds are the domain's bounds. Two numbers here is a 422 an operator cannot see coming.
    expect(CallBmcOperatorSchema.safeParse({ reason: 'x'.repeat(MAX_CALL_REASON) }).success).toBe(true);
    expect(CallBmcOperatorSchema.safeParse({ reason: 'x'.repeat(MAX_CALL_REASON + 1) }).success).toBe(false);
    expect(CallBmcOperatorSchema.safeParse({ reason: 'xx' }).success).toBe(false);
  });

  it('refuses a retired cooler and one that is not this cooperative\'s', () => {
    expect(verdict({ unit: null }).refusals).toEqual(['UNIT_NOT_FOUND']);
    expect(verdict({ unit: { ...UNIT, isActive: false } }).refusals).toEqual(['UNIT_RETIRED']);
    // A unit that is not ours produces ONE reason about the unit, not a cascade about custody as well.
    expect(verdict({ unit: null, custody: null }).refusals).toEqual(['UNIT_NOT_FOUND']);
  });

  it('lists every reason at once, in the order a screen should read them', () => {
    const v = verdict({ canManage: false, unit: { ...UNIT, isActive: false }, reason: '' });
    expect(v.refusals).toEqual(['NO_MANAGE', 'UNIT_RETIRED', 'REASON_REQUIRED']);
  });

  it('reaches every refusal it declares', () => {
    const seen = new Set<string>();
    for (const o of [
      { canManage: false }, { unit: null }, { unit: { ...UNIT, isActive: false } }, { custody: null },
      { actorUserId: 'raju' }, { reason: '' }, { reason: 'x'.repeat(MAX_CALL_REASON + 1) },
    ]) verdict(o).refusals.forEach((r) => seen.add(r));
    expect([...BMC_CALL_REFUSALS].filter((c) => !seen.has(c))).toEqual([]);
  });

  it('shows the object with the temperature\'s own currency, never a phone number', () => {
    const o = callObject(
      { id: 'u-1', mccCode: 'MCC-AND-03', mccName: 'Keshod' },
      { tempC: '6.9', telemetry: telemetryVerdict(new Date('2026-08-21T13:38:00Z'), NOW, 15) },
      HOLDER,
    );
    expect(o.tempC).toBe('6.9');
    // Forty minutes at a fifteen-minute threshold: the reading is NOT the tank's condition, and this is often the very
    // reason for the call.
    expect(o.tempIsCurrent).toBe(false);
    expect(o.gapMinutes).toBe(40);
    expect(o.operatorName).toBe('Raju Patel');
    expect(o.operatorUnnamed).toBe(false);
    expect(JSON.stringify(o)).not.toMatch(/phone|mobile/i);
  });

  it('says the holder is UNNAMED rather than printing a name nothing stands behind', () => {
    // 6d-2's tenancy-checked join returns no name for a user who holds no active role in this cooperative. The call is
    // still placeable — the provider bridges by id — and the screen says which situation it is in.
    const o = callObject(
      { id: 'u-1', mccCode: 'MCC-AND-03', mccName: 'Keshod' },
      { tempC: null, telemetry: telemetryVerdict(null, NOW, 15) },
      { ...HOLDER, operatorName: null },
    );
    expect(o.operatorUnnamed).toBe(true);
    expect(o.operatorName).toBeNull();
    expect(o.tempIsCurrent).toBe(false);
    expect(o.gapMinutes).toBeNull();
    expect(callVerdict({ canManage: true, actorUserId: 'desk', unit: UNIT, custody: { ...HOLDER, operatorName: null }, reason: 'rising fast' }).allowed).toBe(true);
  });

  it('keeps the telemetry-gap Retry a PAGE LOAD, not a mutation', () => {
    // TENANT-6a's ruling, reused rather than restated: nothing on this platform can poll a cooler, so a Retry that
    // appeared to fetch a reading would lie about what it did.
    expect(gapRetryIsAPageLoad()).toBe(true);
  });
});

describe('PC-56 TENANT-6d-5 · the act, and what it refuses to claim', () => {
  const harness = (over: Record<string, unknown> = {}) => {
    const ctx = {
      unit: { toProps: () => ({ id: 'u-1', mccId: 'c-1', isActive: true }) },
      mccCode: 'MCC-AND-03', mccName: 'Keshod',
      lastTempDeci: 69, lastAt: new Date('2026-08-21T13:38:00Z'),
      custody: { operatorUserId: 'raju', operatorName: 'Raju Patel', assignedAt: new Date('2026-06-01T05:00:00Z') },
    };
    const units = {
      callContext: jest.fn(async () => ctx),
      thresholds: jest.fn(async () => ({ divertDeci: 75, condemnDeci: 80, silenceMinutes: 15 })),
      ...over,
    };
    const calls = { initiate: jest.fn(async () => ({ id: 'call-1' })) };
    const audit = { write: jest.fn() };
    const outbox = { write: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const svc = new BmcCallService(uow as never, outbox as never, { inc: jest.fn(), observe: jest.fn() } as never,
      audit as never, units as never, calls as never);
    return { svc, units, calls, audit, outbox };
  };
  const desk = { userId: 'desk', canManage: true };

  it('bridges by USER ID and files the call against the cooler', async () => {
    const h = harness();
    const r = await h.svc.place('t1', desk as never, 'idem-1', 'u-1', '  tank at 6.9 and rising  ', '10.0.0.1');
    expect(h.calls.initiate).toHaveBeenCalledTimes(1);
    const [, , key, dto] = h.calls.initiate.mock.calls[0] as unknown as [string, unknown, string, Record<string, unknown>];
    // The CLIENT's key travels all the way to the provider: a retried tablet request must not ring a phone twice.
    expect(key).toBe('idem-1');
    expect(dto).toEqual({ calleeUserId: 'raju', contextType: 'bmc_unit', contextId: 'u-1' });
    expect(r.maskedCallId).toBe('call-1');
    // The reason is TRIMMED, once, where it is recorded — not re-trimmed by three callers.
    expect(r.reason).toBe('tank at 6.9 and rising');
  });

  it('writes the audit row with the actor, the reason and the call it refers to', async () => {
    const h = harness();
    await h.svc.place('t1', desk as never, 'idem-1', 'u-1', 'tank at 6.9 and rising', null);
    const [, entry] = h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(entry.action).toBe('dairy.bmc.operator_called');
    expect(entry.entityType).toBe('bmc_unit');
    expect(entry.entityId).toBe('u-1');
    expect(entry.reason).toBe('tank at 6.9 and rising');
    expect(entry.actorUserId).toBe('desk');
    // The temperature at the moment of the call, so a trail read in six months says what was seen.
    expect(entry.newValue).toMatchObject({ maskedCallId: 'call-1', calleeUserId: 'raju', tempC: '6.9' });
    // NO PHONE NUMBER anywhere in the row.
    expect(JSON.stringify(entry)).not.toMatch(/phone|\+91/i);
    expect(h.outbox.write).toHaveBeenCalledTimes(1);
  });

  it('DIALS FIRST and audits second, so no row claims a call that did not happen', async () => {
    const h = harness();
    h.calls.initiate.mockRejectedValueOnce(new Error('provider down'));
    await expect(h.svc.place('t1', desk as never, 'idem-1', 'u-1', 'tank at 6.9', null)).rejects.toThrow('provider down');
    // The order is the whole ruling: an audit row written first would assert a call that never connected.
    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
  });

  it('RE-TAKES its verdict at the moment it acts', async () => {
    // Custody can change hands between reading a confirm screen and pressing its button — 6d-2 made that a first-class
    // act. A confirm step is not an authorisation token.
    const h = harness({ callContext: jest.fn(async () => ({
      unit: { toProps: () => ({ id: 'u-1', mccId: 'c-1', isActive: true }) },
      mccCode: 'MCC-AND-03', mccName: 'Keshod', lastTempDeci: 69, lastAt: new Date(), custody: null,
    })) });
    await expect(h.svc.place('t1', desk as never, 'idem-1', 'u-1', 'tank at 6.9', null))
      .rejects.toBeInstanceOf(BmcCallRefusedError);
    expect(h.calls.initiate).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('refuses without dairy.manage, and dials nothing on the way to the refusal', async () => {
    const h = harness();
    await expect(h.svc.place('t1', { userId: 'clerk', canManage: false } as never, 'k', 'u-1', 'because', null))
      .rejects.toBeInstanceOf(BmcCallRefusedError);
    expect(h.calls.initiate).not.toHaveBeenCalled();
  });

  it('previews without writing, dialling, or taking an idempotency key', async () => {
    const h = harness();
    const p = await h.svc.preview('t1', desk as never, 'u-1', '  ');
    expect(p.allowed).toBe(false);
    expect(p.refusals).toEqual(['REASON_REQUIRED']);
    expect(p.object.mccCode).toBe('MCC-AND-03');
    expect(p.reason).toBeNull();
    expect(h.calls.initiate).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.outbox.write).not.toHaveBeenCalled();
    expect(BmcCallService.prototype.preview.length).toBe(4);   // tenantId, actor, unitId, reason — no key
  });

  it('names what it still cannot do', () => {
    // A failed call leaves no record, the audit row cannot join the bridge's transaction, and nobody knows whether the
    // operator answered. Named in one place a test can read, not implied by absence.
    expect(BmcCallService.notes()).toEqual(['failed_call_unrecorded', 'audit_after_bridge', 'answer_unknown']);
  });
});

describe('PC-56 TENANT-6d-5 · what the monitor reports about the automatic call', () => {
  const rmHarness = (over: { rules?: unknown[]; delivery?: Record<string, number>; flag?: boolean } = {}) => {
    const delivery = over.delivery ?? { ev: 1, sms: 3, crit_ev: 1, crit_ivr: 3 };
    const replica = { forTenant: () => ({
      query: jest.fn(async (sql: string) => (sql.includes('SELECT now()') ? { rows: [{ n: NOW }] } : { rows: [delivery] })),
    }) };
    const units = {
      monitor: jest.fn(async () => []),
      thresholds: jest.fn(async () => ({ divertDeci: 75, condemnDeci: 80, silenceMinutes: 15 })),
      windowCounts: jest.fn(async () => ({ readings: 0, breaches: 0, units: 0 })),
      series: jest.fn(async () => []),
    };
    const alerts = { listRules: jest.fn(async () => over.rules ?? []) };
    const flags = { isEnabled: jest.fn(async () => over.flag ?? true) };
    const rm = new DairyBmcReadModel(replica as never, units as never, alerts as never, flags as never,
      { inc: jest.fn(), observe: jest.fn() } as never);
    return { rm, flags, replica };
  };
  const actor = { userId: 'desk', canManage: true };

  it('reports the TIGHTEST silence rule, because that is the one that pages first', async () => {
    // Two rules is the case that matters and the case a single-rule harness cannot see (the mutation pass found this):
    // `min` and `max` agree whenever there is one rule, and disagree the moment a cooperative writes two.
    const h = rmHarness({ rules: [
      { kind: 'device_silent', threshold: { silentMinutes: 45 }, recipientUserIds: ['a'] },
      { kind: 'device_silent', threshold: { silentHours: 12 }, recipientUserIds: ['b'] },
      { kind: 'device_silent', threshold: { silentMinutes: 15 }, recipientUserIds: ['a'] },
    ] });
    const v = await h.rm.view('t1', actor as never, {});
    expect(v.alerting.silentRules).toBe(3);
    expect(v.alerting.silenceRuleMinutes).toBe(15);
    // Fifteen minutes is exactly the number the screen calls a gap, so the canon's sentence is true as written.
    expect(v.alerting.silenceMatchesGap).toBe(true);
    expect(v.alerting.recipients).toBe(2);
  });

  it('says the rule and the screen DISAGREE when they do', async () => {
    const h = rmHarness({ rules: [{ kind: 'device_silent', threshold: { silentHours: 12 }, recipientUserIds: ['b'] }] });
    const v = await h.rm.view('t1', actor as never, {});
    expect(v.alerting.silenceRuleMinutes).toBe(720);
    expect(v.alerting.silenceMatchesGap).toBe(false);
  });

  it('READS whether a critical alert can reach anybody, rather than assuming it', async () => {
    const ok = await rmHarness().rm.view('t1', actor as never, {});
    expect(ok.alerting.criticalCatalogued).toBe(true);
    expect(ok.alerting.criticalVoiceDeliverable).toBe(true);
    // A deployment behind 0165: catalogued nowhere, so quiet hours silence every phone channel until morning.
    const behind = await rmHarness({ delivery: { ev: 1, sms: 3, crit_ev: 0, crit_ivr: 0 } }).rm.view('t1', actor as never, {});
    expect(behind.alerting.criticalCatalogued).toBe(false);
    expect(behind.alerting.criticalVoiceDeliverable).toBe(false);
    // Catalogued, but the voice copy is missing or unversioned: a text and a push, and no call.
    const noVoice = await rmHarness({ delivery: { ev: 1, sms: 3, crit_ev: 1, crit_ivr: 0 } }).rm.view('t1', actor as never, {});
    expect(noVoice.alerting.criticalCatalogued).toBe(true);
    expect(noVoice.alerting.criticalVoiceDeliverable).toBe(false);
  });

  it('counts a template as deliverable ONLY when it has a serving version', async () => {
    // 0122's send-time gate INNER JOINs the serving version: a template with none resolves to nothing and every send is
    // recorded as `no_template`, silently. Asserted on the SQL, because that clause is the whole difference between
    // "there is copy" and "it can be sent".
    const rm = fs.readFileSync(path.join(__dirname, '../read-models/dairy-bmc.read-model.ts'), 'utf8');
    const q = rm.slice(rm.indexOf('crit_ev'), rm.indexOf('crit_ivr`)'));
    expect(q).toContain('serving_version_id IS NOT NULL');
    expect(q).toContain("channel = 'ivr'");
    expect(q).toContain('is_active = true');
  });

  it('READS the call flag, so the monitor never draws a button that 404s', async () => {
    const on = rmHarness({ flag: true });
    expect((await on.rm.view('t1', actor as never, {})).callEnabled).toBe(true);
    expect(on.flags.isEnabled).toHaveBeenCalledWith(BMC_CALL_FLAG, { tenantId: 't1' });
    const off = rmHarness({ flag: false });
    expect((await off.rm.view('t1', actor as never, {})).callEnabled).toBe(false);
  });
});

describe('PC-56 TENANT-6d-5 · the routes and the flag', () => {
  const postPaths = () => {
    const proto = BmcController.prototype as unknown as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((m) => m !== 'constructor')
      .filter((m) => Reflect.getMetadata(METHOD_METADATA, proto[m] as never) === RequestMethod.POST)
      .map((m) => Reflect.getMetadata(PATH_METADATA, proto[m] as never) as string | undefined)
      .filter((p): p is string => typeof p === 'string');
  };

  it('declares call/preview before every parameterised POST', () => {
    const paths = postPaths();
    expect(paths).toContain('call/preview');
    expect(paths).toContain(':id/call');
    const firstParam = paths.findIndex((p) => p.includes(':'));
    expect(paths.indexOf('call/preview')).toBeLessThan(firstParam);
  });

  it('puts BOTH call routes behind their own flag, composing with the module and the monitor', () => {
    const proto = BmcController.prototype as unknown as Record<string, unknown>;
    for (const m of ['previewCall', 'call']) {
      const keys = Reflect.getMetadata('feature_flag', proto[m] as never) as string[] | undefined;
      expect({ m, keys }).toEqual({ m, keys: [BMC_CALL_FLAG] });
    }
    // The class carries the module + monitor flags; TENANT-6d-2 made them COMPOSE rather than override, so a route
    // flag adds a requirement instead of cancelling its controller's.
    const classKeys = Reflect.getMetadata('feature_flag', BmcController) as string[] | undefined;
    expect(classKeys).toEqual(['dairy', 'dairy_bmc_monitor']);
  });

  it('flags the call OFF by default, and says the alarm does not depend on it', () => {
    const m = mig();
    const block = m.slice(m.indexOf("('dairy_bmc_call'"), m.indexOf('165.5'));
    expect(block).toContain('false, 100');
    // The ruling that makes this flag safe: a kill-switch on a human dialling must not silence the machine paging.
    expect(block).toMatch(/kill-switch on a human dialling a phone must not silence the machine/);
    expect(BMC_CALL_FLAG).toBe('dairy_bmc_call');
  });
});
