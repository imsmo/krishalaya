// apps/web-partner/src/test/partner5-refusals.spec.ts · PC-56 PARTNER-5a — the PARTNER-5 registry: all 31 canon files, each with ONE
// verdict (5a's 12 decided: W223 / W222 BUILT (read), W2929–W2930 and W3024–W3025 DECOR, W2931–W2933 and W3026–W3028 PARITY-DECOR; 5b's 13
// `pending_5b` and 5c's 6 `pending_5c`); four chains as query states, their ten files recorded once; every refusal and chain sentence in
// en, hi AND gu with the same placeholders; every English refusal says no; the DELTAs of F-15 / F-16 recorded; i18n parity for partner5.*.
import * as fs from 'node:fs';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  PARTNER5_CANON_FILES, PARTNER5_CHAINS, PARTNER5_DELTAS, PARTNER5_REFUSALS, chain5ById, chain5State, partner5RefusalKeys, type Partner5Surface,
} from '../features/partner5/refusals';
import { PARTNER4_REFUSALS } from '../features/partner4/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
/** The survey's §C list for PARTNER-5, verbatim — 31 files. */
const SURVEY_C = [
  'W214-partner-sla-reports.html', 'W219-partner-collections.html', 'W220-partner-collections-case.html', 'W221-partner-restructure.html',
  'W222-partner-writeoffs.html', 'W223-partner-dpd-aging.html',
  'W2914-partner-collections-form-form-error.html', 'W2915-partner-collections-form-review.html', 'W2916-partner-collections-form-success.html',
  'W2917-partner-collections-form-failure.html', 'W2918-partner-collections-mutate-confirm.html', 'W2919-partner-collections-mutate-success.html',
  'W2920-partner-collections-mutate-failure.html', 'W2929-partner-dpd-export-queued.html', 'W2930-partner-dpd-export-ready.html',
  'W2931-partner-dpd-mutate-confirm.html', 'W2932-partner-dpd-mutate-success.html', 'W2933-partner-dpd-mutate-failure.html',
  'W2999-partner-restructure-mutate-confirm.html', 'W3000-partner-restructure-mutate-success.html', 'W3001-partner-restructure-mutate-failure.html',
  'W3009-partner-sla-export-queued.html', 'W3010-partner-sla-export-ready.html', 'W3011-partner-sla-mutate-confirm.html',
  'W3012-partner-sla-mutate-success.html', 'W3013-partner-sla-mutate-failure.html', 'W3024-partner-writeoffs-export-queued.html',
  'W3025-partner-writeoffs-export-ready.html', 'W3026-partner-writeoffs-mutate-confirm.html', 'W3027-partner-writeoffs-mutate-success.html',
  'W3028-partner-writeoffs-mutate-failure.html',
];
const SURFACES_5A: readonly Partner5Surface[] = ['aging', 'writeoffs', 'aging_export', 'aging_act', 'writeoffs_export', 'writeoffs_act'];
const chainKeys = (c: { states: readonly string[]; key: (s: string) => string }) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]);
const SAYS_NO = /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b/i;

describe('PC-56 PARTNER-5a · the PARTNER-5 canon registry', () => {
  it('31 files — the survey §C list exactly — each with ONE verdict: 5a = 12 decided, 5b = 13 pending_5b, 5c = 6 pending_5c; each exists on disk', () => {
    const files = PARTNER5_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(31); expect(new Set(files).size).toBe(31);
    expect([...files].sort()).toEqual([...SURVEY_C].sort());
    const v = (f: string) => PARTNER5_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict;
    for (const f of ['W223', 'W222']) expect([f, v(f)]).toEqual([f, 'BUILT (read)']);
    for (const f of ['W2929', 'W2930', 'W3024', 'W3025']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2931', 'W2932', 'W2933', 'W3026', 'W3027', 'W3028']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    expect(PARTNER5_CANON_FILES.filter((f) => f.wave === '5a').length).toBe(12);
    expect(PARTNER5_CANON_FILES.filter((f) => f.wave === '5a' && !/pending/.test(f.verdict)).length).toBe(12);
    expect(PARTNER5_CANON_FILES.filter((f) => f.wave === '5b').map((f) => f.verdict)).toEqual(Array(13).fill('pending_5b'));
    expect(PARTNER5_CANON_FILES.filter((f) => f.wave === '5c').map((f) => f.verdict)).toEqual(Array(6).fill('pending_5c'));
    // the 5b / 5c files are pending by THEIR OWN wave, never decided here
    expect(PARTNER5_CANON_FILES.filter((f) => f.verdict === 'pending_5b').every((f) => f.wave === '5b')).toBe(true);
    expect(PARTNER5_CANON_FILES.filter((f) => f.verdict === 'pending_5c').every((f) => f.wave === '5c')).toBe(true);
    for (const f of PARTNER5_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    // every file exists on disk in the canon folder (asserted, not skipped: the canon is on this machine)
    expect(fs.existsSync(CANON)).toBe(true);
    for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('FOUR chains, all query states of their pages; the TEN chain files of 5a recorded exactly once, each a DECOR / PARITY-DECOR file', () => {
    expect(PARTNER5_CHAINS.map((c) => [c.id, c.wave, c.page, c.param, c.states, c.files, !!c.mailbox])).toEqual([
      ['aging_export', '5a', '/lender/portfolio/aging', 'export', ['queued', 'ready'], ['W2929', 'W2930'], true],
      ['aging_act', '5a', '/lender/portfolio/aging', 'act', ['confirm', 'success', 'failure'], ['W2931', 'W2932', 'W2933'], false],
      ['writeoffs_export', '5a', '/lender/portfolio/writeoffs', 'export', ['queued', 'ready'], ['W3024', 'W3025'], true],
      ['writeoffs_act', '5a', '/lender/portfolio/writeoffs', 'act', ['confirm', 'success', 'failure'], ['W3026', 'W3027', 'W3028'], false],
    ]);
    const all = PARTNER5_CHAINS.flatMap((c) => c.files);
    expect(all.length).toBe(10); expect(new Set(all).size).toBe(10);
    for (const id of all) {
      expect([id, PARTNER5_CANON_FILES.some((f) => f.file.startsWith(`${id}-`) && f.wave === '5a' && (f.verdict === 'DECOR' || f.verdict === 'PARITY-DECOR'))]).toEqual([id, true]);
    }
    // the export chains are DECOR, the act chains PARITY-DECOR — by the registry's own verdicts
    const verdict = (id: string) => PARTNER5_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.verdict;
    for (const c of PARTNER5_CHAINS) for (const id of c.files) expect([c.id, id, verdict(id)]).toEqual([c.id, id, c.mailbox ? 'DECOR' : 'PARITY-DECOR']);
    // a chain state is a whitelist: anything else is the page itself
    expect([chain5State('aging_export', { export: 'queued' }), chain5State('aging_export', { export: 'confirm' }), chain5State('aging_export', { act: 'ready' })]).toEqual(['queued', null, null]);
    expect([chain5State('aging_act', { act: 'confirm' }), chain5State('aging_act', { act: 'write' }), chain5State('aging_act', {}), chain5State('aging_act', undefined)]).toEqual(['confirm', null, null, null]);
    expect(chain5State('writeoffs_export', { export: ['ready', 'queued'] })).toBe('ready');
    expect(chain5State('writeoffs_act', { act: 'failure' })).toBe('failure');
    expect(chain5ById('writeoffs_act').surface).toBe('writeoffs_act');
  });
  it('every refusal / chain key exists in en, hi and gu with the same placeholders; every English refusal says no; EVERY 5a surface prints at least one', () => {
    const keys = [...PARTNER5_REFUSALS.map((r) => r.key), ...PARTNER5_CHAINS.flatMap(chainKeys),
      'partner5.subnav.writeoffs', 'partner5.subnav.aging', 'partner5.aging.statement', 'partner5.aging.restructuredNote',
      'partner5.writeoffs.statement', 'partner5.writeoffs.lockdownNote', 'partner5.aging.sumCheck', 'partner4.export.notAvailable', 'partner4.chain.back'];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const r of PARTNER5_REFUSALS) expect([r.id, SAYS_NO.test(en[r.key])]).toEqual([r.id, true]);
    expect(new Set(PARTNER5_REFUSALS.map((r) => r.id)).size).toBe(PARTNER5_REFUSALS.length);
    for (const s of SURFACES_5A) expect([s, partner5RefusalKeys(s).length > 0]).toEqual([s, true]);
    // no 5b / 5c surface carries a refusal yet: their doors are their own waves'
    for (const s of ['collections', 'collections_case', 'restructure', 'sla', 'collections_form', 'collections_act', 'case_act', 'restructure_act', 'sla_export', 'sla_act'] as const) {
      expect([s, partner5RefusalKeys(s)]).toEqual([s, []]);
    }
    for (const r of PARTNER5_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, /^partner[45]\.refusal\./.test(r.key), r.surfaces.every((x) => SURFACES_5A.includes(x))]).toEqual([r.id, true, true, true, true]);
    }
    // one surface never prints the same sentence twice
    for (const s of SURFACES_5A) expect([s, new Set(partner5RefusalKeys(s)).size]).toEqual([s, partner5RefusalKeys(s).length]);
  });
  it('the refusals the brief names are registered — W223\'s, W222\'s, the chain sentences — and the reused PARTNER-4 keys are the real ones', () => {
    expect(PARTNER5_REFUSALS.map((r) => r.id)).toEqual(expect.arrayContaining([
      // W223
      'percent_of_book', 'missed_instalments', 'five_buckets', 'pre_review', 'cure_machinery', 'computed_nightly', 'aging_roles', 'plan_settings', 'bucket_drilldown',
      // W222
      'written_off_share', 'books_not_story', 'cause_column', 'recovered_since', 'causes_documented', 'writeoff_gates', 'post_writeoff_conduct',
      'dairy_case', 'cattle_insurance_rule', 'recorded_with_evidence', 'gate_exists', 'records_immutable', 'board_committee', 'writeoff_date',
      // the chains
      'board_pack', 'export_file', 'chain_zero_sum', 'chain_on_call', 'chain_audit']));
    // the reused keys are PARTNER-4's own (the dairy-case insurance rule REUSES 4b's `cattle_insurance_rule` by key — brief §E)
    const p4 = (id: string) => PARTNER4_REFUSALS.find((r) => r.id === id)?.key;
    const p5 = (id: string) => PARTNER5_REFUSALS.find((r) => r.id === id)?.key;
    for (const id of ['cattle_insurance_rule', 'export_file', 'chain_zero_sum', 'chain_on_call', 'chain_audit', 'plan_settings', 'written_off_share']) {
      expect([id, p5(id)]).toEqual([id, p4(id)]);
    }
    expect(p5('cattle_insurance_rule')).toBe('partner4.refusal.cattleInsuranceRule');
    expect(p5('aging_roles')).toBe(p4('platform_roles'));
    // each refusal's why names its file:line truth or its founder decision
    for (const r of PARTNER5_REFUSALS) expect([r.id, /:\d|founder|survey|refusals\.ts|DECOR|WALL|FALSE/.test(r.why)]).toEqual([r.id, true]);
  });
  it('the DELTAs of F-15 and F-16 are recorded: FM:166 / :169 / :167 / :172 / :171 / :175, the W13xx rot, the orphans, the drill-ins, the six buckets', () => {
    const ids = PARTNER5_DELTAS.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['fm_footer_filter', 'fm_td_filter', 'fm_avatar_filter', 'fm_dead_nav_detail', 'fm_chain_ids',
      'orphans_subnav', 'drill_ins', 'six_buckets', 'sum_check_both', 'two_windows', 'chain_routes']));
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of PARTNER5_DELTAS) expect([d.id, d.canon.length > 0, d.built.length > 0]).toEqual([d.id, true, true]);
    const D = (id: string) => PARTNER5_DELTAS.find((d) => d.id === id) as { canon: string; built: string };
    expect(D('fm_footer_filter').canon).toMatch(/FM:166/);
    expect(D('fm_td_filter').canon).toMatch(/FM:169/);
    expect(D('fm_avatar_filter').canon).toMatch(/FM:167.*FM:172/);
    expect(D('fm_dead_nav_detail').canon).toMatch(/FM:171.*FM:175/);
    for (const m of ['W1387/W1388 → W3024/W3025', 'W1389–W1391 → W3026–W3028', 'W1392/W1393 → W2929/W2930', 'W1394–W1396 → W2931–W2933']) {
      expect([m, D('fm_chain_ids').built.includes(m)]).toEqual([m, true]);
    }
    expect(D('orphans_subnav').canon).toMatch(/TOTAL ORPHANS/);
    expect(D('orphans_subnav').built).toMatch(/sub-navigation/);
    expect(D('drill_ins').canon).toMatch(/FM:31.*FM:32/);
    expect(D('six_buckets').built).toMatch(/SIX/);
  });
  it('i18n parity: every partner5.* key of en is in hi AND gu, non-empty, placeholders kept, not an English copy; and no value carries "%"', () => {
    const fresh = Object.keys(en).filter((k) => k.startsWith('partner5.'));
    expect(fresh.length).toBe(72);
    for (const cat of [hi, gu]) expect(Object.keys(cat).filter((k) => k.startsWith('partner5.')).sort()).toEqual([...fresh].sort());
    for (const k of fresh) {
      expect([k, typeof hi[k] === 'string' && hi[k].length > 0, typeof gu[k] === 'string' && gu[k].length > 0]).toEqual([k, true, true]);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
      if (en[k].length > 12) expect([k, hi[k] !== en[k] && gu[k] !== en[k]]).toEqual([k, true]);
      for (const cat of [en, hi, gu]) expect([k, cat[k].includes('%')]).toEqual([k, false]);
    }
  });
});
