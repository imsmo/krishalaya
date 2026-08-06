// apps/web-ops/src/test/devices-alerting.spec.ts · OW-7 (PC-55 B4). Pins the rules that decide whether an alert
// channel stays trustworthy: a threshold the API will actually accept, a cooldown that can dedupe, recipients who
// are real, and a fleet view that never claims to be an equipment register.
import {
  ALERT_KINDS, ALERT_SEVERITIES, CHANNEL_HINTS, COOLDOWN_MAX, COOLDOWN_MIN, MAX_RECIPIENTS, THRESHOLD_KEYS,
  isAlertKind, isAlertSeverity, isChannelHint, defaultsFor, buildThreshold, parseRecipients, buildAlertRule,
  buildRulePatch, hoursSince, deviceHealth, fleetSummary, needsAck, feedOrder,
} from '../features/devices/alerting';

const U1 = '00000000-0000-7000-8000-000000000001';
const U2 = '00000000-0000-7000-8000-000000000002';
const T = { windowHours: '', minBreaches: '', subjectType: '', silentHours: '', maintenanceAlert: '' };
const ruleForm = (over: Record<string, string> = {}) => ({
  kind: 'cold_chain_breach', ruleName: 'Vaccine van — any breach', recipients: U1,
  channelHint: '', cooldownMinutes: '', ...T, ...over,
});

describe('vocabularies + thresholds mirror the API (ops-alert.rules.ts)', () => {
  it('kinds, severities, channels', () => {
    expect([...ALERT_KINDS]).toEqual(['cold_chain_breach', 'device_silent', 'maintenance_due']);
    expect([...ALERT_SEVERITIES]).toEqual(['info', 'warning', 'critical']);
    expect([...CHANNEL_HINTS]).toEqual(['push', 'sms', 'whatsapp', 'email', 'inapp']);
    expect(isAlertKind('cold_chain_breach')).toBe(true);
    expect(isAlertKind('temperature')).toBe(false);
    expect(isAlertSeverity('fatal')).toBe(false);
    expect(isChannelHint('pigeon')).toBe(false);
  });

  it('offers exactly the threshold keys each kind accepts — an unknown key would disable a rule silently', () => {
    expect([...THRESHOLD_KEYS.cold_chain_breach]).toEqual(['windowHours', 'minBreaches', 'subjectType']);
    expect([...THRESHOLD_KEYS.device_silent]).toEqual(['silentHours']);
    expect([...THRESHOLD_KEYS.maintenance_due]).toEqual(['alert']);
  });

  it('uses the API’s own defaults, so a blank form still produces a WORKING rule', () => {
    expect(defaultsFor('cold_chain_breach')).toEqual({ windowHours: 6, minBreaches: 1 });
    expect(defaultsFor('device_silent')).toEqual({ silentHours: 12 });
    expect(defaultsFor('maintenance_due')).toEqual({ alert: 'any' });
    expect(buildThreshold('cold_chain_breach', T)).toEqual({ ok: true, value: { windowHours: 6, minBreaches: 1 } });
    expect(buildThreshold('device_silent', T)).toEqual({ ok: true, value: { silentHours: 12 } });
    expect(buildThreshold('maintenance_due', T)).toEqual({ ok: true, value: { alert: 'any' } });
  });

  it('keeps every numeric bound the API keeps, and never truncates a fractional value into a different rule', () => {
    expect(buildThreshold('cold_chain_breach', { ...T, windowHours: '168' }).ok).toBe(true);
    expect(buildThreshold('cold_chain_breach', { ...T, windowHours: '169' })).toEqual({ ok: false, error: 'windowHours' });
    expect(buildThreshold('cold_chain_breach', { ...T, windowHours: '0' })).toEqual({ ok: false, error: 'windowHours' });
    expect(buildThreshold('cold_chain_breach', { ...T, windowHours: '6.5' })).toEqual({ ok: false, error: 'windowHours' });
    expect(buildThreshold('cold_chain_breach', { ...T, minBreaches: '1001' })).toEqual({ ok: false, error: 'minBreaches' });
    expect(buildThreshold('device_silent', { ...T, silentHours: '720' }).ok).toBe(true);
    expect(buildThreshold('device_silent', { ...T, silentHours: '721' })).toEqual({ ok: false, error: 'silentHours' });
    expect(buildThreshold('maintenance_due', { ...T, maintenanceAlert: 'whenever' })).toEqual({ ok: false, error: 'maintenanceAlert' });
  });

  it('sends only the keys that were filled (a partial threshold is not padded with guesses)', () => {
    expect(buildThreshold('cold_chain_breach', { ...T, minBreaches: '5' })).toEqual({ ok: true, value: { minBreaches: 5 } });
    expect(buildThreshold('cold_chain_breach', { ...T, subjectType: 'shipment' })).toEqual({ ok: true, value: { subjectType: 'shipment' } });
  });
});

describe('recipients — nobody should be paged twice for one event', () => {
  it('accepts a list separated by newlines, commas or spaces, and collapses duplicates', () => {
    expect(parseRecipients(`${U1}\n${U2}`)).toEqual({ ok: true, value: [U1, U2] });
    expect(parseRecipients(`${U1}, ${U2}`)).toEqual({ ok: true, value: [U1, U2] });
    expect(parseRecipients(`${U1} ${U1}`)).toEqual({ ok: true, value: [U1] });
  });
  it('refuses an empty list, a bad id, and more than the API allows', () => {
    expect(parseRecipients('   ')).toEqual({ ok: false, error: 'recipients' });
    expect(parseRecipients('someone@example.com')).toEqual({ ok: false, error: 'recipientId' });
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`).join('\n');
    expect(parseRecipients(many)).toEqual({ ok: false, error: 'tooManyRecipients' });
  });
});

describe('buildAlertRule', () => {
  it('builds a complete rule with defaults filled in', () => {
    const r = buildAlertRule(ruleForm());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      kind: 'cold_chain_breach', ruleName: 'Vaccine van — any breach',
      threshold: { windowHours: 6, minBreaches: 1 }, recipientUserIds: [U1],
    });
    expect('cooldownMinutes' in r.value).toBe(false);   // absent, so the API applies its own default
  });

  it('refuses an unknown kind, a too-short name and a bad channel', () => {
    expect(buildAlertRule(ruleForm({ kind: 'temperature' }))).toEqual({ ok: false, error: 'kind' });
    expect(buildAlertRule(ruleForm({ ruleName: 'ab' }))).toEqual({ ok: false, error: 'name' });
    expect(buildAlertRule(ruleForm({ ruleName: 'x'.repeat(151) }))).toEqual({ ok: false, error: 'name' });
    expect(buildAlertRule(ruleForm({ channelHint: 'pigeon' }))).toEqual({ ok: false, error: 'channel' });
  });

  it('keeps the cooldown inside 5 minutes … one week (the number the dedupe actually buckets on)', () => {
    expect(COOLDOWN_MIN).toBe(5);
    expect(COOLDOWN_MAX).toBe(10080);
    expect(buildAlertRule(ruleForm({ cooldownMinutes: '5' })).ok).toBe(true);
    expect(buildAlertRule(ruleForm({ cooldownMinutes: '10080' })).ok).toBe(true);
    expect(buildAlertRule(ruleForm({ cooldownMinutes: '4' }))).toEqual({ ok: false, error: 'cooldown' });
    expect(buildAlertRule(ruleForm({ cooldownMinutes: '10081' }))).toEqual({ ok: false, error: 'cooldown' });
    expect(buildAlertRule(ruleForm({ cooldownMinutes: '30.5' }))).toEqual({ ok: false, error: 'cooldown' });
  });

  it('surfaces a threshold failure as a threshold error, not a generic one', () => {
    expect(buildAlertRule(ruleForm({ windowHours: '999' }))).toEqual({ ok: false, error: 'threshold_windowHours' });
    expect(buildAlertRule(ruleForm({ kind: 'device_silent', silentHours: '0' }))).toEqual({ ok: false, error: 'threshold_silentHours' });
  });
});

describe('buildRulePatch — an edit is not a back door around the create rules', () => {
  it('requires at least one real change', () => {
    expect(buildRulePatch({})).toEqual({ ok: false, error: 'empty' });
    expect(buildRulePatch({ ruleName: '   ' })).toEqual({ ok: false, error: 'empty' });
  });
  it('carries the pause switch in both directions', () => {
    expect(buildRulePatch({ isActive: '0' })).toEqual({ ok: true, value: { isActive: false } });
    expect(buildRulePatch({ isActive: '1' })).toEqual({ ok: true, value: { isActive: true } });
  });
  it('re-validates every field it does carry', () => {
    expect(buildRulePatch({ ruleName: 'ab' })).toEqual({ ok: false, error: 'name' });
    expect(buildRulePatch({ cooldownMinutes: '1' })).toEqual({ ok: false, error: 'cooldown' });
    expect(buildRulePatch({ recipients: 'nope' })).toEqual({ ok: false, error: 'recipientId' });
    expect(buildRulePatch({ recipients: `${U1},${U1}` })).toEqual({ ok: true, value: { recipientUserIds: [U1] } });
  });
});

describe('reading the fleet honestly', () => {
  const NOW = Date.parse('2026-08-06T12:00:00.000Z');
  const at = (iso: string) => ({ deviceRef: 'd1', lastSeen: iso, readings24h: 10, breaches24h: 0 });

  it('measures silence in whole hours since the last reading', () => {
    expect(hoursSince('2026-08-06T11:00:00.000Z', NOW)).toBe(1);
    expect(hoursSince('2026-08-06T12:30:00.000Z', NOW)).toBe(0);   // a future stamp is never negative
    expect(hoursSince(null, NOW)).toBeNull();
    expect(hoursSince('not a date', NOW)).toBeNull();
  });

  it('THE WORST TRUTH WINS: a quiet sensor reads as quiet even while its last readings were breaching', () => {
    const quietAndBreaching = { deviceRef: 'd1', lastSeen: '2026-08-05T12:00:00.000Z', readings24h: 0, breaches24h: 4 };
    expect(deviceHealth(quietAndBreaching, NOW)).toBe('silent');
  });
  it('flags breaching only while the sensor is still reporting, and ok otherwise', () => {
    expect(deviceHealth({ ...at('2026-08-06T11:00:00.000Z'), breaches24h: 2 }, NOW)).toBe('breaching');
    expect(deviceHealth(at('2026-08-06T11:00:00.000Z'), NOW)).toBe('ok');
    expect(deviceHealth({ deviceRef: 'd', lastSeen: null }, NOW)).toBe('unknown');
  });
  it('honours the silence threshold it is given, exactly at the boundary', () => {
    expect(deviceHealth(at('2026-08-06T00:00:00.000Z'), NOW, 12)).toBe('silent');   // exactly 12h → silent
    expect(deviceHealth(at('2026-08-06T00:30:00.000Z'), NOW, 12)).toBe('ok');       // 11h → still reporting
    expect(deviceHealth(at('2026-08-06T00:30:00.000Z'), NOW, 6)).toBe('silent');    // a stricter rule says quiet
  });
  it('counts unknown sensors WITH the silent ones (never quietly into "ok")', () => {
    const rows = [
      at('2026-08-06T11:00:00.000Z'),
      { ...at('2026-08-06T11:00:00.000Z'), breaches24h: 3 },
      at('2026-08-01T11:00:00.000Z'),
      { deviceRef: 'x', lastSeen: null },
    ];
    expect(fleetSummary(rows, NOW, 12)).toEqual({ total: 4, silent: 2, breaching: 1, ok: 1 });
    expect(fleetSummary([], NOW)).toEqual({ total: 0, silent: 0, breaching: 0, ok: 0 });
  });
});

describe('the fired feed puts the thing that is still on fire on top', () => {
  it('acknowledgement is the axis that matters most, then severity, then recency', () => {
    const rows = [
      { id: 'a', severity: 'info', firedAt: '2026-08-06T10:00:00Z', acknowledgedAt: null },
      { id: 'b', severity: 'critical', firedAt: '2026-08-05T10:00:00Z', acknowledgedAt: '2026-08-05T11:00:00Z' },
      { id: 'c', severity: 'critical', firedAt: '2026-08-06T09:00:00Z', acknowledgedAt: null },
      { id: 'd', severity: 'warning', firedAt: '2026-08-06T11:00:00Z', acknowledgedAt: null },
      { id: 'e', severity: 'critical', firedAt: '2026-08-06T11:30:00Z', acknowledgedAt: null },
    ];
    expect([...rows].sort(feedOrder).map((r) => r.id)).toEqual(['e', 'c', 'd', 'a', 'b']);
  });
  it('needsAck is false only once somebody has actually seen it', () => {
    expect(needsAck({ acknowledgedAt: null })).toBe(true);
    expect(needsAck({})).toBe(true);
    expect(needsAck({ acknowledgedAt: '2026-08-06T10:00:00Z' })).toBe(false);
  });
});
