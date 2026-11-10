// apps/web-ops/src/test/ops5a-pages.spec.ts · PC-56 OPS-5a · THE ALERTS — SOURCE ASSERTIONS, the premises, and the pure helpers.
//   READS · POSITIVE CONTROL FIRST: W402 calls the rules and the feed; W403 calls one breach. Then: no ops5 source — and no web-ops source at
//           all — calls breachAct, setThreshold or evaluateAlertRules (E6: "run now" left this console) or acknowledgeAlert; W403 holds no server
//           action and no form; the ONE server action (W402's) calls only the rule change routes;
//   Q1-A · the premise: the organisation's console offers acknowledge, record action and record outcome (a loss with its amount and currency);
//   the sentences' premises read from the code: "no breach rule" (0201's recipients: active breach rules + a shipment's driver), "the people on a
//           breach rule are also told of a breach and a silence" (0201 + the watch job's fallback), "from the logger or typed by a person"
//           (0201 judges every reading; the API body says so);
//   E1    · `/devices/rules` and `/devices/alerts` → 307 `/iot/alert-rules` (mirrors OPS5A_REDIRECTS); "Alert rules" in the Sensors group; the W403
//           edges from W400, W401 and W402; the chain states answered BEFORE any read; W403's chain Back is W403;
//   the pure helpers.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ALERTS, OPS5A_REDIRECTS, asFired, asRules, breachAlerts, buildChange, changeDraft, changeFailure, decisionKey, durationParts, firedFor, incidentHref, kindKey,
  lossOf, noActiveBreachRule, outcomeKey, parseDone, parseFailure, severityKey, silenceAlerts, thresholdWords, timeline,
} from '../features/ops5/alerts';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const SRC = path.join(__dirname, '..');
const REPO = path.join(SRC, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const P = { rules: 'app/iot/alert-rules/page.tsx', actions: 'app/iot/alert-rules/actions.ts', incident: 'app/iot/alert-incident/page.tsx' };
const OPS5 = [...Object.values(P), 'components/ops5/AlertViews.tsx', 'components/ops5/Ops5Chain.tsx', 'features/ops5/alerts.ts', 'features/ops5/refusals.ts'];
const walk = (dir: string): string[] => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.next' || e.name === 'dist' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const SRC_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/[\\/](test|test-render)[\\/]/.test(f));
const ID = '0192d2c4-c001-7000-8000-000000000c01';
const U1 = '00000000-0000-7000-8000-000000000001'; const U2 = '00000000-0000-7000-8000-000000000002'; const U3 = '00000000-0000-7000-8000-000000000003';

describe('PC-56 OPS-5a · reads, and the one act (positive control first)', () => {
  it('CONTROL: W402 reads the rules and the feed; W403 reads one breach', () => {
    expect(code(read(P.rules))).toMatch(/\.shipments\.alertRules\(\{\}\)/);
    expect(code(read(P.rules))).toMatch(/\.shipments\.alertFeed\(\{ limit: 200 \}\)/);
    expect(code(read(P.incident))).toMatch(/\.coldChain\.breach\(id\)/);
  });
  it('no web-ops source calls a breach act, a band (threshold), "run the rules now" or an acknowledge (E6, Q1-A)', () => {
    const FORBIDDEN = /\b(breachAct|setThreshold|evaluateAlertRules|acknowledgeAlert|evaluateNow)\s*\(/;
    expect(SRC_FILES.length).toBeGreaterThan(50);
    for (const f of SRC_FILES) expect([path.relative(SRC, f), FORBIDDEN.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
    for (const f of OPS5) expect([f, /tenancy\.analytics|\.breachAct|\.setThreshold|evaluateAlertRules/.test(code(read(f)))]).toEqual([f, false]);
  });
  it('the ONE server action is W402\'s, and it calls only the rule-change routes; W403 holds no action, no form, no button', () => {
    const calls = Array.from(code(read(P.actions)).matchAll(/opsClient\(\)\.(\w+)\.(\w+)\(/g)).map((m) => `${m[1]}.${m[2]}`);
    expect([...new Set(calls)].sort()).toEqual(['shipments.alertRules', 'shipments.confirmAlertRuleChange', 'shipments.createAlertRule', 'shipments.updateAlertRule', 'shipments.withdrawAlertRuleChange']);
    expect(/^\s*['"]use server['"]/m.test(read(P.incident))).toBe(false);
    const v = code(read('components/ops5/AlertViews.tsx'));
    const incident = v.slice(v.indexOf('export function AlertIncidentView'));
    expect(/<form|<button|<input|<select|<textarea|action=/.test(incident)).toBe(false);
  });
  it('no person: the view never reads an id, a note, an outcome reason, a buyer\'s reason or a proposal\'s reason into words', () => {
    const v = code(read('components/ops5/AlertViews.tsx'));
    expect(/recipientUserIds|proposedBy\b|confirmedBy|acknowledgedBy|actorUserId|createdBy|updatedBy|buyerUserId/.test(v)).toBe(false);
    // a note / reason is read only to say whether one EXISTS — never printed
    for (const m of Array.from(v.matchAll(/(actionNote|outcomeReason|buyer\.reason)/g))) {
      const line = v.split('\n').find((l) => l.includes(m[0])) as string;
      expect([m[0], /\? '(exists)'|\? t\.t\(|\? <>/.test(line) && !/\{b\.(actionNote|outcomeReason|buyer\.reason)\}/.test(line)]).toEqual([m[0], true]);
    }
  });
});

describe('PC-56 OPS-5a · the premises, read from the code', () => {
  it('Q1-A: the organisation\'s cold-chain console offers acknowledge, record action and record outcome — a loss with its amount and currency', () => {
    const swe = fs.readFileSync(path.join(REPO, 'apps/web-tenant/src/features/swe/console.ts'), 'utf8');
    expect(swe).toContain("export const BREACH_ACTS = ['acknowledge', 'record_action', 'record_outcome'] as const;");
    expect(swe).toContain("'loss_recorded'");
    const act = fs.readFileSync(path.join(REPO, 'apps/web-tenant/src/app/ops/logistics/cold-chain/breaches/act/page.tsx'), 'utf8');
    expect(act).toContain('name="lossMinor"');
    expect(fs.readFileSync(path.join(REPO, 'apps/web-tenant/src/app/ops/logistics/cold-chain/breaches/act/actions.ts'), 'utf8')).toMatch(/coldChain\.breachAct\(id, act,/);
    expect(en['ops5.q1.words']).toBe('Acknowledging a breach, recording what was done and recording its outcome — including any loss — are done on the organisation\'s cold-chain console, not here.');
  });
  it('the "no breach rule" sentence: 0201 tells the active breach rules\' people AND a shipment\'s driver; nobody → no_recipient', () => {
    const mig = fs.readFileSync(path.join(REPO, 'db/migrations/0201_logistics_ops.sql'), 'utf8');
    expect(mig).toContain("WHERE r.tenant_id = NEW.tenant_id AND r.kind = 'cold_chain_breach' AND r.is_active AND r.deleted_at IS NULL");
    expect(mig).toContain("SELECT s.rider_user_id::text FROM shipments s WHERE NEW.subject_type = 'shipment'");
    expect(mig).toContain("CASE WHEN jsonb_array_length(recips) > 0 THEN 'alerted' ELSE 'no_recipient' END");
    expect(en['ops5.alerts.noBreachRule']).toContain('except the driver, when the breach is on a shipment that has one');
  });
  it('the silence sentence: the watch job tells the active silence rules\' people, else the active breach rules\'', () => {
    const r = fs.readFileSync(path.join(REPO, 'apps/api/src/modules/logistics/repositories/cold-chain-ops.repository.ts'), 'utf8');
    expect(r).toContain("kind IN ('device_silent', 'cold_chain_breach')) q");
    expect(r).toContain("WHERE q.kind = 'device_silent' OR NOT EXISTS (SELECT 1 FROM ops_alert_rules r WHERE r.tenant_id=$1 AND r.is_active AND r.deleted_at IS NULL AND r.kind = 'device_silent')");
  });
  it('"from the logger or typed by a person": 0201 judges EVERY reading against the band copied at write; the rule\'s body says so', () => {
    const mig = fs.readFileSync(path.join(REPO, 'db/migrations/0201_logistics_ops.sql'), 'utf8');
    const before = mig.slice(mig.indexOf('NEW.server_recorded_at := now();'), mig.indexOf('CREATE TRIGGER trg_ccl_before'));
    expect(before).toContain('NEW.is_breach := b.min_c IS NOT NULL AND (NEW.temp_c < b.min_c OR NEW.temp_c > b.max_c);');
    expect(/source/.test(before)).toBe(false);   // no source condition on the excursion flag
    const svc = fs.readFileSync(path.join(REPO, 'apps/api/src/modules/logistics/services/ops-alert.service.ts'), 'utf8');
    expect(svc).toContain('out-of-band reading(s), from the logger or typed by a person, in the last');
  });
});

describe('PC-56 OPS-5a · E1 · the 307s, the nav, the edges, the chain order', () => {
  it('next.config.js redirects() carries OPS5A_REDIRECTS as 307s (permanent: false); the OW-7 pages are gone', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(SRC, '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    const got = (await cfg.redirects()).filter((x) => x.source.startsWith('/devices/'));
    expect(got).toEqual(OPS5A_REDIRECTS.map((x) => ({ ...x, permanent: false })));
    expect(OPS5A_REDIRECTS).toEqual([{ source: '/devices/rules', destination: '/iot/alert-rules' }, { source: '/devices/alerts', destination: '/iot/alert-rules' }]);
    for (const p of ['app/devices/actions.ts', 'app/devices/rules/page.tsx', 'app/devices/alerts/page.tsx']) expect([p, fs.existsSync(path.join(SRC, p))]).toEqual([p, false]);
    // nothing links, redirects or revalidates to the OW-7 addresses (the registries and OPS5A_REDIRECTS name them only as history / the 307's source)
    for (const f of SRC_FILES) expect([path.relative(SRC, f), /(href=|redirect\(|revalidatePath\(|href: )\{?\s*['"`]\/devices\/(rules|alerts)/.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
  });
  it('the sidebar: "Alert rules" in the Sensors group (the OW-7 link replaced, same key)', () => {
    const nav = read('components/Sidebar.tsx');
    expect(nav).toMatch(/\{ href: '\/iot\/device-health', labelKey: 'nav\.iotHealth', sub: true \}, [^\n]*\n\s*\{ href: '\/iot\/alert-rules', labelKey: 'nav\.iotAlerts', sub: true \}/);
    expect(/href: '\/iot\/alert-incident'/.test(nav)).toBe(false);   // W403 is reached from a breach, never from the nav
    expect([en['nav.iotAlerts'], hi['nav.iotAlerts'] !== en['nav.iotAlerts'], gu['nav.iotAlerts'] !== en['nav.iotAlerts']]).toEqual(['Alert rules', true, true]);
  });
  it('the W403 edges: W400\'s last breach, each breach on W401, each breach alert on W402', () => {
    const iot = code(read('components/ops4/IotViews.tsx'));
    expect(iot).toMatch(/href=\{incidentHref\(lastBreach\.id\)\} data-kv-edge="W403"/);
    expect(iot).toMatch(/href=\{incidentHref\(b\.id\)\} data-kv-edge="W403"/);
    expect(code(read('components/ops5/AlertViews.tsx'))).toMatch(/href=\{incidentHref\(f\.breachId as string\)\} data-kv-edge="W403"/);
    expect(incidentHref(ID)).toBe(`/iot/alert-incident?id=${ID}`);
  });
  it('the chain states are answered BEFORE any read; W403\'s chain goes Back to W403 (never W402)', () => {
    const r = code(read(P.rules));
    expect(r.indexOf("chain5State('alert_act'")).toBeGreaterThan(-1);
    expect(r.indexOf("state=\"success\"")).toBeLessThan(r.indexOf('opsClient()'));
    expect(r.indexOf("state=\"failure\"")).toBeLessThan(r.indexOf('opsClient()'));
    const i = code(read(P.incident));
    expect(i.indexOf("chain5State('incident_act'")).toBeGreaterThan(-1);
    expect(i.indexOf("chain5State('incident_act'")).toBeLessThan(i.indexOf('opsClient()'));
    expect(i).toMatch(/<Ops5Chain t=\{t\} chain="incident_act" state=\{act\} page=\{id \? incidentHref\(id\) : ALERTS\.incident\} \/>/);
    expect(ALERTS).toEqual({ rules: '/iot/alert-rules', incident: '/iot/alert-incident' });
  });
  it('one arithmetic only (the breach duration); no sum, reduce, percentage or float parse in any ops5 source', () => {
    for (const rel of OPS5) {
      const src = code(read(rel));
      expect([rel, /\.reduce\(|parseFloat|toFixed|BigInt\(/.test(src)]).toEqual([rel, false]);
      if (rel !== 'features/ops5/refusals.ts') expect([rel, /['"`][^'"`\n]*%[^'"`\n]*['"`]/.test(src)]).toEqual([rel, false]);   // the registry quotes the canon's own "[n]%" to refuse it
    }
    const a = code(read('features/ops5/alerts.ts'));
    expect((a.match(/Math\./g) ?? []).length).toBe(1);
    expect(a).toContain('return { min: Math.floor(seconds / 60), sec: seconds % 60 };');
    expect(/Math\./.test(code(read('components/ops5/AlertViews.tsx')))).toBe(false);
  });
});

describe('PC-56 OPS-5a · the pure helpers', () => {
  const RAW = [{ id: ID, kind: 'cold_chain_breach', ruleName: 'Cooler', threshold: { windowHours: 6, minBreaches: 2 }, recipientUserIds: [U1, U2], cooldownMinutes: 60, isActive: true,
    lastEvaluatedAt: '2026-11-10T02:00:00.000Z', createdBy: U1, updatedBy: U2, lastChange: { action: 'change_confirmed', at: '2026-11-10T03:00:00.000Z', byYou: false },
    openChange: { id: U3, proposedBy: U1, proposedByYou: true, proposedAt: '2026-11-10T04:00:00.000Z', reason: 'Testperson asked for it', changes: [{ field: 'isActive', direction: 'quieter' }, { field: 'evil', direction: 'quieter' }] } }];
  it('asRules: people become a COUNT; no id, no reason, no unknown change field survives', () => {
    const [r] = asRules(RAW);
    expect(r).toEqual({ id: ID, kind: 'cold_chain_breach', ruleName: 'Cooler', threshold: { windowHours: 6, minBreaches: 2 }, recipientCount: 2, cooldownMinutes: 60, isActive: true,
      lastEvaluatedAt: '2026-11-10T02:00:00.000Z', lastChange: { action: 'change_confirmed', at: '2026-11-10T03:00:00.000Z', byYou: false },
      openChange: { id: U3, proposedAt: '2026-11-10T04:00:00.000Z', proposedByYou: true, changes: [{ field: 'isActive', direction: 'quieter' }] } });
    expect(JSON.stringify(r)).not.toMatch(new RegExp(`${U1}|${U2}|Testperson`));
    expect(asRules([{ id: 'x' }, null, 'y'])).toEqual([]);
  });
  it('thresholdWords: the server\'s defaults; either source; a typed filter never printed; minutes or hours as written', () => {
    expect(thresholdWords('cold_chain_breach', {})).toEqual({ key: 'ops5.alerts.th.breach', vars: { n: 1, h: 6 } });
    expect(thresholdWords('cold_chain_breach', { minBreaches: 3, windowHours: 12, subjectType: 'shipment' })).toEqual({ key: 'ops5.alerts.th.breachOnly', vars: { n: 3, h: 12, type: 'ops4.iot.type.shipment' } });
    expect(thresholdWords('cold_chain_breach', { subjectType: 'Testperson van' })).toEqual({ key: 'ops5.alerts.th.breachFiltered', vars: { n: 1, h: 6 } });
    expect(thresholdWords('device_silent', { silentMinutes: 30 })).toEqual({ key: 'ops5.alerts.th.silentMinutes', vars: { m: 30 } });
    expect(thresholdWords('device_silent', { silentHours: 2 })).toEqual({ key: 'ops5.alerts.th.silentHours', vars: { h: 2 } });
    expect(thresholdWords('maintenance_due', {})).toEqual({ key: 'ops5.alerts.th.maintenance.any', vars: {} });
    expect(thresholdWords('maintenance_due', { alert: 'whenever' }).key).toBe('ops5.alerts.th.unknown');
    expect(en['ops5.alerts.th.breach']).toContain('from the logger or typed by a person');
    expect([kindKey('device_silent'), kindKey('humidity')]).toEqual(['ops5.alerts.kind.device_silent', 'ops5.alerts.kind.unknown']);
  });
  it('noActiveBreachRule: true only when no ACTIVE breach rule names someone', () => {
    const [r] = asRules(RAW);
    expect([noActiveBreachRule([]), noActiveBreachRule([r]), noActiveBreachRule([{ ...r, isActive: false }]), noActiveBreachRule([{ ...r, kind: 'device_silent' }])]).toEqual([true, false, true, true]);
  });
  it('asFired: told as a count, the breach id for its file; a rule\'s own; the breaches\' and silences\' own', () => {
    const rows = asFired([
      { id: U1, ruleId: ID, kind: 'cold_chain_breach', severity: 'critical', firedAt: 'x', recipients: [U2, U3], acknowledgedAt: null, acknowledgedBy: U2, subjectRef: 'Testperson cooler' },
      { id: U2, ruleId: null, kind: 'cold_chain_breach', severity: 'critical', firedAt: 'y', recipients: [], detail: { breachId: U3 } },
      { id: U3, ruleId: null, kind: 'device_silent', severity: 'warning', firedAt: 'z', recipients: [U1] },
    ]);
    expect(rows[0]).toEqual({ id: U1, ruleId: ID, kind: 'cold_chain_breach', severity: 'critical', firedAt: 'x', told: 2, acknowledgedAt: null, breachId: null });
    expect(JSON.stringify(rows)).not.toContain('Testperson');
    expect(firedFor(rows, ID).map((r) => r.id)).toEqual([U1]);
    expect(breachAlerts(rows).map((r) => [r.id, r.breachId, r.told])).toEqual([[U2, U3, 0]]);
    expect(silenceAlerts(rows).map((r) => r.id)).toEqual([U3]);
    expect([severityKey('critical'), severityKey('fatal')]).toEqual(['ops5.alerts.severity.critical', 'ops5.alerts.severity.unknown']);
  });
  it('the change act: a named refusal by its code; the server\'s answer by name; nothing guessed', () => {
    expect([changeFailure(403, 'ALERT_RULE_CONFIRMER_IS_PROPOSER'), changeFailure(409, 'ALERT_RULE_CHANGED_SINCE_PROPOSAL'), changeFailure(403, null), changeFailure(404, 'X'), changeFailure(422, null), changeFailure(500, null)])
      .toEqual(['confirmerIsProposer', 'changedSinceProposal', 'forbidden', 'notFound', 'refused', 'save']);
    expect([parseFailure('withdrawNotProposer'), parseFailure('<script>'), parseDone('proposed'), parseDone('paused')]).toEqual(['withdrawNotProposer', 'save', 'proposed', null]);
  });
  it('buildChange: people after = now + added − removed (never the ids printed); the last person cannot go; the threshold merged; a reason always', () => {
    const cur = { recipientUserIds: [U1, U2], threshold: { windowHours: 6, minBreaches: 2 } };
    const d = (o: Record<string, string>) => changeDraft((k) => o[k] ?? '');
    expect(buildChange('cold_chain_breach', cur, d({ add: U3, remove: U1, reason: 'Night shift swap' }))).toEqual({ ok: true, value: { recipientUserIds: [U2, U3], reason: 'Night shift swap' } });
    expect(buildChange('cold_chain_breach', cur, d({ remove: `${U1},${U2}`, reason: 'Night shift swap' }))).toEqual({ ok: false, error: 'lastRecipient' });
    expect(buildChange('cold_chain_breach', cur, d({ minBreaches: '5', reason: 'Fewer false alarms' }))).toEqual({ ok: true, value: { threshold: { windowHours: 6, minBreaches: 5 }, reason: 'Fewer false alarms' } });
    expect(buildChange('cold_chain_breach', cur, d({ isActive: 'pause', reason: 'Cooler away for repair' }))).toEqual({ ok: true, value: { isActive: false, reason: 'Cooler away for repair' } });
    expect(buildChange('cold_chain_breach', cur, d({ isActive: 'resume', reason: 'short' }))).toEqual({ ok: false, error: 'reason' });
    expect(buildChange('cold_chain_breach', cur, d({ reason: 'Nothing chosen at all' }))).toEqual({ ok: false, error: 'empty' });
    expect(buildChange('cold_chain_breach', cur, d({ windowHours: '6.5', reason: 'Nothing chosen at all' }))).toEqual({ ok: false, error: 'threshold_windowHours' });
    expect(buildChange('device_silent', cur, d({ add: 'not-an-id', reason: 'Night shift swap' }))).toEqual({ ok: false, error: 'recipientId' });
    expect(buildChange('device_silent', cur, d({ cooldownMinutes: '4', reason: 'Night shift swap' }))).toEqual({ ok: false, error: 'cooldown' });
  });
  it('W403: the duration split for reading; the timeline in order, only what the server recorded; a loss only with its own currency; words', () => {
    expect([durationParts(1320), durationParts(59), durationParts(null), durationParts(-1)]).toEqual([{ min: 22, sec: 0 }, { min: 0, sec: 59 }, null, null]);
    expect(timeline({ firstOutAt: 'a', openedAt: 'b', acknowledgedAt: null, actionAt: 'c', closedAt: 'd', outcomeAt: null, buyer: { offeredAt: 'e', decidedAt: null } }).map((s) => s.step))
      .toEqual(['firstOut', 'opened', 'action', 'backInRange', 'buyerOffered']);   // time order (text compare of the server's strings)
    expect([lossOf({ minor: '125000', currency: 'INR' }), lossOf({ minor: '12.5', currency: 'INR' }), lossOf({ minor: '100', currency: null }), lossOf(null)]).toEqual([{ minor: '125000', currency: 'INR' }, null, null, null]);
    expect([outcomeKey('loss_recorded'), outcomeKey('closed'), decisionKey('accept_with_test'), decisionKey('x')]).toEqual(['ops5.incident.outcome.loss_recorded', 'ops5.incident.outcome.unknown', 'ops5.incident.decision.accept_with_test', 'ops5.incident.decision.unknown']);
  });
});
