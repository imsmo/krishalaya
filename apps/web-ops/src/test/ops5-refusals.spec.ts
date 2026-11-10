// apps/web-ops/src/test/ops5-refusals.spec.ts · PC-56 OPS-5 — the registry (survey E8): 11 canon files, one verdict each; 8 chain files, each in
// exactly one of three chain groups; the chains; every refusal key in en/hi/gu; every English refusal says no (the negative-word rule).
// NAMED UPDATE (PC-56 OPS-5b): 5b decides its 6 — 11 decided, 0 pending, and the `pending_5b` value is gone from the type (the 4c-7 rule); the
// count test, the chain test and the surface test now pin 5b's verdicts, chains and refusals exactly (nothing loosened: each `expect` that held
// "5b pending / prints nothing" now holds the decided value).
import {
  OPS5_CANON_FILES, OPS5_CHAIN_GROUPS, OPS5_CHAINS, OPS5_DELTAS, OPS5_REFUSALS, SURFACES_5A, SURFACES_5B, chain5ById, chain5State, ops5RefusalKeys,
  type Ops5Surface,
} from '../features/ops5/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const NEG = /\b(not|no|never|nothing|none|cannot|nobody)\b|n't\b/i;
const FILES = ['W369-ops-insights.html', 'W402-ops-alert-rules.html', 'W403-ops-alert-incident.html', 'W3292-ops-alert-mutate-confirm.html', 'W3293-ops-alert-mutate-success.html',
  'W3294-ops-alert-mutate-failure.html', 'W3321-ops-insights-export-queued.html', 'W3322-ops-insights-export-ready.html', 'W3323-ops-insights-mutate-confirm.html',
  'W3324-ops-insights-mutate-success.html', 'W3325-ops-insights-mutate-failure.html'];

describe('PC-56 OPS-5 · the registry', () => {
  it('11 canon files (survey §C, the 11 the ops4c gate left uncovered), each once, one verdict; 5a decides 5, 5b 6 — 11 decided, 0 pending', () => {
    expect(OPS5_CANON_FILES.map((f) => f.file).sort()).toEqual([...FILES].sort());
    expect(new Set(OPS5_CANON_FILES.map((f) => f.file)).size).toBe(11);
    const a = OPS5_CANON_FILES.filter((f) => f.wave === '5a'); const b = OPS5_CANON_FILES.filter((f) => f.wave === '5b');
    expect([a.length, b.length]).toEqual([5, 6]);
    const DECIDED = ['BUILT (read)', 'REAL', 'PARITY-DECOR'];
    expect(OPS5_CANON_FILES.filter((f) => DECIDED.includes(f.verdict)).length).toBe(11);
    expect(OPS5_CANON_FILES.filter((f) => !DECIDED.includes(f.verdict)).length).toBe(0);
    expect(OPS5_CANON_FILES.every((f) => f.note.length > 20 && f.note !== 'OPS-5b')).toBe(true);
    expect(Object.fromEntries(a.map((f) => [f.file.split('-')[0], f.verdict]))).toEqual({ W402: 'REAL', W403: 'BUILT (read)', W3292: 'REAL', W3293: 'REAL', W3294: 'REAL' });
    expect(Object.fromEntries(b.map((f) => [f.file.split('-')[0], f.verdict]))).toEqual({ W369: 'BUILT (read)', W3321: 'REAL', W3322: 'REAL', W3323: 'PARITY-DECOR', W3324: 'PARITY-DECOR', W3325: 'PARITY-DECOR' });
    // the type itself: no `pending_` value survives in the registry source
    expect(/pending_/.test(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'features', 'ops5', 'refusals.ts'), 'utf8').split('\n').filter((l: string) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n'))).toBe(false);
  });
  it('the chain groups: 8 files, each in exactly one of three groups; with the 3 pages they make the 11', () => {
    const all = OPS5_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(8);
    expect(OPS5_CHAIN_GROUPS.map((g) => [g.id, g.wave, g.files.length])).toEqual([['alert_mutate', '5a', 3], ['insights_export', '5b', 2], ['insights_mutate', '5b', 3]]);
    expect([...all, 'W369', 'W402', 'W403'].sort()).toEqual(FILES.map((f) => f.split('-')[0]).sort());
  });
  it('5a builds the alert mutate group twice, by its two openers: REAL from W402, PARITY-DECOR from W403; 5b builds the export (REAL) and the re-read (PARITY-DECOR)', () => {
    expect(OPS5_CHAINS.map((c) => [c.id, c.kind, c.group, c.wave])).toEqual([['alert_act', 'REAL', 'alert_mutate', '5a'], ['incident_act', 'PARITY-DECOR', 'alert_mutate', '5a'],
      ['insights_export', 'REAL', 'insights_export', '5b'], ['insights_act', 'PARITY-DECOR', 'insights_mutate', '5b']]);
    expect(chain5ById('insights_export').statement).toBe('ops5.ins.export.statement');
    expect(chain5ById('insights_act').statement).toBe('ops5.ins.q2');
    expect(OPS5_CHAINS.map((c) => [c.id, c.backKey])).toEqual([['alert_act', 'ops5.chain.backRules'], ['incident_act', 'ops5.chain.backIncident'], ['insights_export', 'ops5.chain.backInsights'], ['insights_act', 'ops5.chain.backInsights']]);
    expect(chain5State('insights_act', { act: 'confirm' })).toBe('confirm');
    // every group is built by at least one chain
    expect(new Set(OPS5_CHAINS.map((c) => c.group))).toEqual(new Set(OPS5_CHAIN_GROUPS.map((g) => g.id)));
    expect(chain5ById('alert_act').statement).toBe('ops5.alerts.secondPersonNotice');
    expect(chain5ById('incident_act').statement).toBe('ops5.q1.words');
    expect([chain5State('alert_act', { act: 'confirm' }), chain5State('alert_act', { act: 'nope' }), chain5State('incident_act', { act: ['failure'] }), chain5State('incident_act', {})])
      .toEqual(['confirm', null, 'failure', null]);
    for (const c of OPS5_CHAINS) for (const s of c.states) for (const part of ['title', 'body']) for (const cat of [en, hi, gu]) expect([c.id, s, part, !!cat[`${c.key(s)}.${part}`]]).toEqual([c.id, s, part, true]);
  });
  it('the surfaces: 5a and 5b partition the seven; every refusal names known surfaces; every surface of both waves prints its refusals', () => {
    const ALL: Ops5Surface[] = ['insights', 'alert_rules', 'alert_incident', 'alert_act', 'incident_act', 'insights_export', 'insights_act'];
    expect([...SURFACES_5A, ...SURFACES_5B].sort()).toEqual([...ALL].sort());
    for (const r of OPS5_REFUSALS) for (const s of r.surfaces) expect([r.id, ALL.includes(s)]).toEqual([r.id, true]);
    for (const s of SURFACES_5B) expect([s, ops5RefusalKeys(s).length > 0]).toEqual([s, true]);
    expect(ops5RefusalKeys('insights')).toEqual(expect.arrayContaining(['ops5.refusal.search', 'ops5.refusal.computeSchedule', 'ops5.refusal.quietReasons', 'ops5.refusal.leaderboard', 'ops5.refusal.noShares']));
    expect(ops5RefusalKeys('insights_act')).toEqual(['ops5.refusal.zeroSum', 'ops5.refusal.onCall', 'ops5.refusal.computeSchedule', 'ops5.refusal.insightsActWrites']);
    expect(ops5RefusalKeys('insights_export')).toEqual(['ops5.refusal.exportRecordView']);
    for (const s of SURFACES_5A) expect([s, ops5RefusalKeys(s).length > 0]).toEqual([s, true]);
  });
  it('every refusal: a unique id, its key in en / hi / gu, and the English says NO', () => {
    expect(new Set(OPS5_REFUSALS.map((r) => r.id)).size).toBe(OPS5_REFUSALS.length);
    for (const r of OPS5_REFUSALS) {
      for (const cat of [en, hi, gu]) expect([r.key, typeof cat[r.key] === 'string' && cat[r.key].length > 0]).toEqual([r.key, true]);
      expect([r.key, NEG.test(en[r.key])]).toEqual([r.key, true]);
      expect([r.key, hi[r.key] !== en[r.key] && gu[r.key] !== en[r.key]]).toEqual([r.key, true]);
    }
  });
  it('the deltas: unique ids; the not-printed "no rule" sentence is recorded with why', () => {
    expect(new Set(OPS5_DELTAS.map((d) => d.id)).size).toBe(OPS5_DELTAS.length);
    expect(OPS5_DELTAS.find((d) => d.id === 'no_rule_sentence')?.built).toMatch(/NOT PRINTED AS WORDED/);
    for (const cat of [en, hi, gu]) for (const v of Object.values(cat)) expect(/nobody is told until a rule names who to tell/i.test(v)).toBe(false);
  });
});
