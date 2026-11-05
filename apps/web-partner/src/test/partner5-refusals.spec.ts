// apps/web-partner/src/test/partner5-refusals.spec.ts · PC-56 PARTNER-5a — the PARTNER-5 registry: all 31 canon files, each with ONE
// verdict (5a's 12 decided: W223 / W222 BUILT (read), W2929–W2930 and W3024–W3025 DECOR, W2931–W2933 and W3026–W3028 PARITY-DECOR; and,
// PC-56 PARTNER-5b, 5b's 13 decided: W219 / W220 / W221 BUILT (honest), the ten chain files DECOR; 5c's 6 `pending_5c`); EIGHT chains as
// query states, their TWENTY files recorded once; every refusal and chain sentence in en, hi AND gu with the same placeholders; every
// English refusal says no; the DELTAs of F-15 / F-16 recorded; i18n parity for partner5.*.
// NAMED UPDATES (PARTNER-5b, the 4c-7 rule): the 5b-pending verdict value is DELETED, so the cases that pinned 13 pending files, FOUR
// chains, 72 keys and "no 5b surface carries a refusal yet" now pin 25 decided, EIGHT chains, 162 keys and every 5b surface's refusals.
// NAMED UPDATES (PARTNER-5c, the 4c-7 rule): the LAST pending verdict value is DELETED — the cases that pinned 6 `pending_5c` files, EIGHT
// chains / TWENTY files, 162 keys, "no 5c surface carries a refusal yet" and reused keys from partner4 only now pin 31 decided (W214 BUILT
// (read), W3009–W3010 DECOR, W3011–W3013 PARITY-DECOR), TEN chains / TWENTY-FIVE files, 209 keys, every 5c surface's refusals, and reused
// keys from partner2 (the W254 packs refusal, by key — brief 5c E3) and partner4.
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
const SURFACES_5B: readonly Partner5Surface[] = ['collections', 'collections_case', 'restructure', 'collections_form', 'collections_act', 'case_act', 'restructure_act'];
const SURFACES_5C: readonly Partner5Surface[] = ['sla', 'sla_export', 'sla_act'];
const SURFACES_5AB: readonly Partner5Surface[] = [...SURFACES_5A, ...SURFACES_5B];
const SURFACES_ALL: readonly Partner5Surface[] = [...SURFACES_5AB, ...SURFACES_5C];
const chainKeys = (c: { states: readonly string[]; key: (s: string) => string }) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]);
const SAYS_NO = /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b/i;

describe('PC-56 PARTNER-5a · the PARTNER-5 canon registry', () => {
  it('31 files — the survey §C list exactly — each with ONE verdict: 5a = 12 decided, 5b = 13 decided, 5c = 6 decided; each exists on disk', () => {
    const files = PARTNER5_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(31); expect(new Set(files).size).toBe(31);
    expect([...files].sort()).toEqual([...SURVEY_C].sort());
    const v = (f: string) => PARTNER5_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict;
    for (const f of ['W223', 'W222']) expect([f, v(f)]).toEqual([f, 'BUILT (read)']);
    for (const f of ['W2929', 'W2930', 'W3024', 'W3025']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W2931', 'W2932', 'W2933', 'W3026', 'W3027', 'W3028']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    expect(PARTNER5_CANON_FILES.filter((f) => f.wave === '5a').length).toBe(12);
    expect(PARTNER5_CANON_FILES.filter((f) => f.wave === '5a' && !/pending/.test(f.verdict)).length).toBe(12);
    // PC-56 PARTNER-5b · the three honest pages and the ten DECOR chain files
    for (const f of ['W219', 'W220', 'W221']) expect([f, v(f)]).toEqual([f, 'BUILT (honest)']);
    for (const f of ['W2914', 'W2915', 'W2916', 'W2917', 'W2918', 'W2919', 'W2920', 'W2999', 'W3000', 'W3001']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    expect(PARTNER5_CANON_FILES.filter((f) => f.wave === '5b').length).toBe(13);
    // PC-56 PARTNER-5c · NAMED UPDATE: the SLA page, its export chain and its Retry chain
    expect(v('W214')).toBe('BUILT (read)');
    for (const f of ['W3009', 'W3010']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of ['W3011', 'W3012', 'W3013']) expect([f, v(f)]).toEqual([f, 'PARITY-DECOR']);
    expect(PARTNER5_CANON_FILES.filter((f) => f.wave === '5c').length).toBe(6);
    expect(PARTNER5_CANON_FILES.filter((f) => !/pending/.test(f.verdict)).length).toBe(31);
    // the 4c-7 rule: NO pending value exists any more — not as a verdict, and not as a string anywhere in the registry's source
    for (const f of PARTNER5_CANON_FILES) expect([f.file, ['BUILT (read)', 'BUILT (honest)', 'PARITY-DECOR', 'DECOR'].includes(f.verdict)]).toEqual([f.file, true]);
    expect(fs.readFileSync(require.resolve('../features/partner5/refusals'), 'utf8')).not.toMatch(/pending_\w/);
    for (const f of PARTNER5_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    // every file exists on disk in the canon folder (asserted, not skipped: the canon is on this machine)
    expect(fs.existsSync(CANON)).toBe(true);
    for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('TEN chains, all query states of their pages; the TWENTY-FIVE chain files (5a\'s ten, 5b\'s ten, 5c\'s five) recorded exactly once, each a DECOR / PARITY-DECOR file', () => {
    expect(PARTNER5_CHAINS.map((c) => [c.id, c.wave, c.page, c.param, c.states, c.files, !!c.mailbox])).toEqual([
      ['aging_export', '5a', '/lender/portfolio/aging', 'export', ['queued', 'ready'], ['W2929', 'W2930'], true],
      ['aging_act', '5a', '/lender/portfolio/aging', 'act', ['confirm', 'success', 'failure'], ['W2931', 'W2932', 'W2933'], false],
      ['writeoffs_export', '5a', '/lender/portfolio/writeoffs', 'export', ['queued', 'ready'], ['W3024', 'W3025'], true],
      ['writeoffs_act', '5a', '/lender/portfolio/writeoffs', 'act', ['confirm', 'success', 'failure'], ['W3026', 'W3027', 'W3028'], false],
      // PC-56 PARTNER-5b · all DECOR, none with a mailbox (the collections form chain must not offer to relay anything)
      ['collections_form', '5b', '/lender/collections/[id]', 'form', ['error', 'review', 'success', 'failure'], ['W2914', 'W2915', 'W2916', 'W2917'], false],
      ['collections_act', '5b', '/lender/collections', 'act', ['confirm', 'success', 'failure'], ['W2918', 'W2919', 'W2920'], false],
      ['case_act', '5b', '/lender/collections/[id]', 'act', ['confirm', 'success', 'failure'], [], false],
      ['restructure_act', '5b', '/lender/collections/[id]/restructure', 'act', ['confirm', 'success', 'failure'], ['W2999', 'W3000', 'W3001'], false],
      // PC-56 PARTNER-5c · NAMED UPDATE: the export DECOR with the mailbox; Retry the PARITY-DECOR re-read
      ['sla_export', '5c', '/lender/reports', 'export', ['queued', 'ready'], ['W3009', 'W3010'], true],
      ['sla_act', '5c', '/lender/reports', 'act', ['confirm', 'success', 'failure'], ['W3011', 'W3012', 'W3013'], false],
    ]);
    const all = PARTNER5_CHAINS.flatMap((c) => c.files);
    expect(all.length).toBe(25); expect(new Set(all).size).toBe(25);
    for (const c of PARTNER5_CHAINS) for (const id of c.files) {
      expect([id, PARTNER5_CANON_FILES.some((f) => f.file.startsWith(`${id}-`) && f.wave === c.wave && (f.verdict === 'DECOR' || f.verdict === 'PARITY-DECOR'))]).toEqual([id, true]);
    }
    // every DECOR / PARITY-DECOR canon file of 5a, 5b and (PARTNER-5c) 5c is some chain's file
    for (const f of PARTNER5_CANON_FILES.filter((x) => x.verdict === 'DECOR' || x.verdict === 'PARITY-DECOR')) {
      expect([f.file, all.includes(f.file.slice(0, f.file.indexOf('-')))]).toEqual([f.file, true]);
    }
    // 5a: the export chains are DECOR, the act chains PARITY-DECOR; 5b: every chain is DECOR (the pages read nothing, so no Retry is a re-read)
    const verdict = (id: string) => PARTNER5_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.verdict;
    for (const c of PARTNER5_CHAINS) for (const id of c.files) expect([c.id, id, verdict(id)]).toEqual([c.id, id, c.wave === '5b' || c.mailbox ? 'DECOR' : 'PARITY-DECOR']);
    // each 5b chain prints its page's pinned statement; no 5b chain carries a mailbox
    expect(PARTNER5_CHAINS.filter((c) => c.wave === '5b').map((c) => [c.id, c.statement, !!c.mailbox])).toEqual([
      ['collections_form', 'partner5.case.statement', false], ['collections_act', 'partner5.collections.statement', false],
      ['case_act', 'partner5.case.statement', false], ['restructure_act', 'partner5.restructure.statement', false]]);
    expect([chain5State('collections_form', { form: 'review' }), chain5State('collections_form', { form: 'confirm' }), chain5State('collections_form', { act: 'review' })]).toEqual(['review', null, null]);
    expect([chain5State('case_act', { act: 'confirm' }), chain5State('restructure_act', { act: 'failure' }), chain5State('collections_act', { act: 'take' })]).toEqual(['confirm', 'failure', null]);
    // a chain state is a whitelist: anything else is the page itself
    expect([chain5State('aging_export', { export: 'queued' }), chain5State('aging_export', { export: 'confirm' }), chain5State('aging_export', { act: 'ready' })]).toEqual(['queued', null, null]);
    expect([chain5State('aging_act', { act: 'confirm' }), chain5State('aging_act', { act: 'write' }), chain5State('aging_act', {}), chain5State('aging_act', undefined)]).toEqual(['confirm', null, null, null]);
    expect(chain5State('writeoffs_export', { export: ['ready', 'queued'] })).toBe('ready');
    expect(chain5State('writeoffs_act', { act: 'failure' })).toBe('failure');
    expect(chain5ById('writeoffs_act').surface).toBe('writeoffs_act');
  });
  it('every refusal / chain key exists in en, hi and gu with the same placeholders; every English refusal says no; EVERY 5a and 5b surface prints at least one', () => {
    const keys = [...PARTNER5_REFUSALS.map((r) => r.key), ...PARTNER5_CHAINS.flatMap(chainKeys),
      'partner5.subnav.writeoffs', 'partner5.subnav.aging', 'partner5.aging.statement', 'partner5.aging.restructuredNote',
      'partner5.writeoffs.statement', 'partner5.writeoffs.lockdownNote', 'partner5.aging.sumCheck', 'partner4.export.notAvailable', 'partner4.chain.back',
      'partner5.subnav.collections', 'partner5.collections.statement', 'partner5.collections.noSellingBlock', 'partner5.case.statement', 'partner5.restructure.statement',
      // PC-56 PARTNER-5c
      'partner5.sla.promise', 'partner5.sla.promiseNone', 'partner5.sla.promiseSetBy', 'partner5.sla.zeroReason', 'nav.slaReports', 'partner1.ops.mailbox'];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const r of PARTNER5_REFUSALS) expect([r.id, SAYS_NO.test(en[r.key])]).toEqual([r.id, true]);
    expect(new Set(PARTNER5_REFUSALS.map((r) => r.id)).size).toBe(PARTNER5_REFUSALS.length);
    // PC-56 PARTNER-5c · NAMED UPDATE: every surface — 5c's three included — prints at least one refusal; a reused key may be partner2's
    // (the W254 packs refusal, by key) as well as partner4's
    for (const s of SURFACES_ALL) expect([s, partner5RefusalKeys(s).length > 0]).toEqual([s, true]);
    for (const r of PARTNER5_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, /^partner[245]\.refusal\./.test(r.key), r.surfaces.every((x) => SURFACES_ALL.includes(x))]).toEqual([r.id, true, true, true, true]);
    }
    expect(PARTNER5_REFUSALS.filter((r) => r.key.startsWith('partner2.')).map((r) => r.key)).toEqual(['partner2.refusal.reportPack']);
    // one surface never prints the same sentence twice
    for (const s of SURFACES_ALL) expect([s, new Set(partner5RefusalKeys(s)).size]).toEqual([s, partner5RefusalKeys(s).length]);
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
    expect(fresh.length).toBe(209);   // PC-56 PARTNER-5b: 72 + 90; PARTNER-5c (NAMED UPDATE): + 47 (22 sla, 10 chain, 15 refusal)
    for (const cat of [hi, gu]) expect(Object.keys(cat).filter((k) => k.startsWith('partner5.')).sort()).toEqual([...fresh].sort());
    for (const k of fresh) {
      expect([k, typeof hi[k] === 'string' && hi[k].length > 0, typeof gu[k] === 'string' && gu[k].length > 0]).toEqual([k, true, true]);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
      if (en[k].length > 12) expect([k, hi[k] !== en[k] && gu[k] !== en[k]]).toEqual([k, true]);
      for (const cat of [en, hi, gu]) expect([k, cat[k].includes('%')]).toEqual([k, false]);
    }
  });
});

describe('PC-56 PARTNER-5b · the collections refusals, by name and by key', () => {
  const p4 = (id: string) => PARTNER4_REFUSALS.find((r) => r.id === id)?.key;
  const p5 = (id: string) => PARTNER5_REFUSALS.find((r) => r.id === id);
  it('PARTNER-4b\'s code-of-conduct refusals are REUSED BY KEY (not copied) — the keys are PARTNER-4\'s own, and exist in partner4.', () => {
    for (const id of ['code_of_conduct', 'contact_hours', 'contact_log', 'mediation_first', 'third_party_agents', 'partner_suspension']) {
      expect([id, p5(id)?.key]).toEqual([id, p4(id)]);
      expect([id, /^partner4\.refusal\./.test(p5(id)?.key ?? '')]).toEqual([id, true]);
      expect([id, typeof en[p5(id)?.key ?? '']]).toEqual([id, 'string']);
      expect([id, p5(id)?.surfaces.includes('collections')]).toEqual([id, true]);
    }
    expect(p5('collections_roles')?.key).toBe(p4('platform_roles'));
    for (const id of ['chain_zero_sum', 'chain_on_call', 'chain_audit']) {
      for (const s of SURFACES_5B.filter((x) => x.endsWith('_form') || x.endsWith('_act'))) expect([id, s, p5(id)?.surfaces.includes(s)]).toEqual([id, s, true]);
    }
    // no partner5. value is a COPY of a reused partner4 sentence
    const reused = new Set(PARTNER5_REFUSALS.filter((r) => r.key.startsWith('partner4.')).map((r) => en[r.key]));
    for (const k of Object.keys(en).filter((x) => x.startsWith('partner5.'))) expect([k, reused.has(en[k])]).toEqual([k, false]);
  });
  it('the refusals the brief names for W219, W220, W221 and the form chain are registered on their surfaces', () => {
    const on = (s: Partner5Surface) => PARTNER5_REFUSALS.filter((r) => r.surfaces.includes(s)).map((r) => r.id);
    expect(on('collections')).toEqual(expect.arrayContaining(['take_next_case', 'named_cases', 'arrears_kpis', 'recovery_measure', 'dairy_inference',
      'auto_threshold', 'all_loans_up_to_date', 'logs_server_side', 'collections_roles', 'plan_settings', 'code_of_conduct', 'contact_hours', 'contact_log']));
    expect(on('collections_case')).toEqual(expect.arrayContaining(['case_identity', 'case_entity', 'case_narrative', 'reconsent_recording', 'contact_entries',
      'mediation_meeting', 'promise_form', 'log_contact', 'promise_ladder', 'off_the_table', 'case_archive', 'contact_log_safe', 'every_open_logged']));
    expect(on('restructure')).toEqual(expect.arrayContaining(['stale_banner', 'terms_comparison', 'weather_clause', 'npa_discipline', 'acceptance_flow',
      'comparison_forever', 'versioned_draft', 'restructure_people', 'take_to_mediation', 'no_acceptance_state', 'starts_from_case', 'collections_roles']));
    expect(on('collections_form')).toEqual(expect.arrayContaining(['promise_form', 'log_contact', 'form_review_checker', 'chain_zero_sum', 'chain_audit']));
    expect(on('collections_act')).toEqual(expect.arrayContaining(['take_next_case', 'logs_server_side']));
    expect(on('restructure_act')).toEqual(expect.arrayContaining(['take_to_mediation', 'versioned_draft']));
    expect(on('case_act')).toEqual(expect.arrayContaining(['contact_log_safe']));
    // the reasoning refusal (the W263 lesson) and the absence line are where the brief puts them
    expect(en['partner5.refusal.dairyInference']).toMatch(/never a lender’s|never a lender's/);
    expect(p5('off_the_table')?.why).toMatch(/partner5\.collections\.noSellingBlock/);
  });
  it('the 5b DELTAs are recorded: the loan id, every id the same page, FM:150 / :151 / :155 / :157 / :163, the form chain naming W219, W2917, the mutate Back, the stale banner, the omitted links, the dead View repayments', () => {
    const ids = PARTNER5_DELTAS.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['case_id_is_loan', 'every_id_same_page', 'fm150_pagination', 'fm_bulkbar_footer', 'fm_avatar_5b',
      'fm_dead_nav_5b', 'fm_omits_cluster_links', 'fm_chain_ids_5b', 'form_chain_names_w219', 'form_retry_to_confirm', 'mutate_back_w219',
      'case_act_no_trigger', 'stale_delta_033', 'view_repayments_dead']));
    expect(new Set(ids).size).toBe(ids.length);
    const D = (id: string) => PARTNER5_DELTAS.find((d) => d.id === id) as { canon: string; built: string };
    expect(D('fm150_pagination').canon).toMatch(/FM:150/);
    expect(D('every_id_same_page').built).toMatch(/SAME page/);
    expect(D('case_id_is_loan').built).toMatch(/LOAN id/);
    for (const m of ['W1377–W1379 → W2918–W2920', 'W1380–W1383 → W2914–W2917', 'W1384–W1386 → W2999–W3001']) expect([m, D('fm_chain_ids_5b').built.includes(m)]).toEqual([m, true]);
  });
});

describe('PC-56 PARTNER-5c · the SLA page\'s refusals, by name and by key (founder 5c-1)', () => {
  const p5 = (id: string) => PARTNER5_REFUSALS.find((r) => r.id === id);
  const p4 = (id: string) => PARTNER4_REFUSALS.find((r) => r.id === id)?.key;
  const on = (s: Partner5Surface) => PARTNER5_REFUSALS.filter((r) => r.surfaces.includes(s)).map((r) => r.id);
  it('every refusal the brief names for W214 is registered on the page; the chains carry theirs', () => {
    expect(on('sla')).toEqual(expect.arrayContaining(['your_contract', 'disbursal_promise', 'data_handling', 'same_scoreboard', 'decision_rate', 'surge_weeks',
      'docs_pause', 'borrower_satisfaction', 'conduct_count', 'report_packs', 'pack_contents', 'pack_schedule', 'packs_kept', 'manifest_format',
      'escalations', 'aging_roles', 'plan_settings', 'export_file']));
    expect(on('sla_export')).toEqual(expect.arrayContaining(['sla_export_file', 'report_packs', 'pack_contents', 'export_file']));
    expect(on('sla_act')).toEqual(expect.arrayContaining(['packs_kept', 'chain_zero_sum', 'chain_on_call', 'chain_audit']));
  });
  it('the reused keys are the earlier waves\' own: the W254 packs refusal (partner2), the four partner roles, plan settings, the export file and the chain sentences (partner4)', () => {
    expect(p5('report_packs')?.key).toBe('partner2.refusal.reportPack');
    expect(p5('aging_roles')?.key).toBe(p4('platform_roles'));
    expect(en['partner4.refusal.platformRoles']).toMatch(/four: administrator, checker, maker and viewer/);
    for (const id of ['plan_settings', 'export_file', 'chain_zero_sum', 'chain_on_call', 'chain_audit']) expect([id, p5(id)?.key]).toEqual([id, p4(id)]);
    // no partner5. value copies a reused sentence
    const reused = new Set(PARTNER5_REFUSALS.filter((r) => !r.key.startsWith('partner5.')).map((r) => en[r.key]));
    for (const k of Object.keys(en).filter((x) => x.startsWith('partner5.sla.') || x.startsWith('partner5.refusal.'))) expect([k, reused.has(en[k])]).toEqual([k, false]);
  });
  it('the 5c DELTAs are recorded: the contract, FM:127 / :128 / :130 / :132, the kebabs, the W13xx chain ids, the query states and the sidebar item', () => {
    const ids = PARTNER5_DELTAS.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['canon_contract', 'fm127_bulkbar', 'fm128_avatar', 'fm130_td_filter', 'fm132_view_dashboard', 'row_kebabs_5c',
      'fm_chain_ids_5c', 'chain_routes_5c', 'sidebar_item']));
    expect(new Set(ids).size).toBe(ids.length);
    const D = (id: string) => PARTNER5_DELTAS.find((d) => d.id === id) as { canon: string; built: string };
    expect(D('fm130_td_filter').canon).toMatch(/FM:130/);
    expect(D('fm132_view_dashboard').built).toMatch(/REAL link to `\/dashboard`/);
    for (const m of ['W1358/W1359 → W3009/W3010', 'W1360–W1362 → W3011–W3013']) expect([m, D('fm_chain_ids_5c').built.includes(m)]).toEqual([m, true]);
    // the registry never copies the canon's hash fragments
    expect(fs.readFileSync(require.resolve('../features/partner5/refusals'), 'utf8')).not.toMatch(/sha256:[0-9a-f]|2b1f|88c4|9e07|41aa/);
  });
});
