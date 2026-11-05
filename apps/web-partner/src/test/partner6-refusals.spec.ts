// apps/web-partner/src/test/partner6-refusals.spec.ts · PC-56 PARTNER-6a — the PARTNER-6 registry: all 31 canon files, each with ONE verdict
// (6a's 5 decided: W260 BUILT (read), W261 BUILT (honest), W2901–W2903 DECOR; 6b's 14 `pending_6b`; 6c's 12 `pending_6c`), every file on disk;
// ONE canon chain as TWO query-state entries (W2901–W2903 recorded once, on W260; W261's entry with `files: []`); every refusal and chain
// sentence in en, hi AND gu with the same placeholders; every English refusal says no; the reused keys exist and are reused BY KEY; the
// DELTAs recorded; and — the i18n parity of this wave (web-partner has no separate i18n-parity spec; partner5-refusals carries the same
// check) — every `partner6.` key in all three catalogues, none English-only, no "%" and no "₹" in any `partner6.` value.
import * as fs from 'node:fs';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  PARTNER6_CANON_FILES, PARTNER6_CHAINS, PARTNER6_DELTAS, PARTNER6_REFUSALS, SETTLEMENTS_REDIRECTS, SURFACES_6A, chain6ById, chain6State, partner6RefusalKeys,
} from '../features/partner6/refusals';
import { PARTNER3_REFUSALS } from '../features/partner3/refusals';
import { PARTNER4_REFUSALS } from '../features/partner4/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
const SAYS_NO = /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b/i;
/** The survey's §C list for PARTNER-6, verbatim — 31 files. */
const SURVEY_C = [
  'W213-partner-consents.html', 'W224-partner-regulatory.html', 'W260-partner-settlements.html', 'W261-partner-settlement-detail.html',
  'W270-partner-notifications.html', 'W271-partner-notification-preferences.html', 'W2901-partner-settlement-mutate-confirm.html',
  'W2902-partner-settlement-mutate-success.html', 'W2903-partner-settlement-mutate-failure.html', 'W2921-partner-consents-export-queued.html',
  'W2922-partner-consents-export-ready.html', 'W2923-partner-consents-mutate-confirm.html', 'W2924-partner-consents-mutate-success.html',
  'W2925-partner-consents-mutate-failure.html', 'W2960-partner-notification-form-form-error.html', 'W2961-partner-notification-form-review.html',
  'W2962-partner-notification-form-success.html', 'W2963-partner-notification-form-failure.html', 'W2964-partner-notification-mutate-confirm.html',
  'W2965-partner-notification-mutate-success.html', 'W2966-partner-notification-mutate-failure.html', 'W2967-partner-notifications-mutate-confirm.html',
  'W2968-partner-notifications-mutate-success.html', 'W2969-partner-notifications-mutate-failure.html', 'W2987-partner-regulatory-form-form-error.html',
  'W2988-partner-regulatory-form-review.html', 'W2989-partner-regulatory-form-success.html', 'W2990-partner-regulatory-form-failure.html',
  'W2991-partner-regulatory-mutate-confirm.html', 'W2992-partner-regulatory-mutate-success.html', 'W2993-partner-regulatory-mutate-failure.html',
];
const chainKeys = (c: { states: readonly string[]; key: (s: string) => string }) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]);

describe('PC-56 PARTNER-6a · the PARTNER-6 canon registry', () => {
  it('31 files — the survey §C list exactly — each with ONE verdict: 6a = 5 decided, 6b = 14 pending_6b, 6c = 12 pending_6c; each exists on disk', () => {
    const files = PARTNER6_CANON_FILES.map((f) => f.file);
    expect([...files].sort()).toEqual([...SURVEY_C].sort());
    expect(new Set(files).size).toBe(31);
    for (const f of PARTNER6_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6a').map((f) => [f.file.slice(0, f.file.indexOf('-')), f.verdict])).toEqual([
      ['W260', 'BUILT (read)'], ['W261', 'BUILT (honest)'], ['W2901', 'DECOR'], ['W2902', 'DECOR'], ['W2903', 'DECOR']]);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6b').every((f) => f.verdict === 'pending_6b')).toBe(true);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6b').length).toBe(14);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6c').every((f) => f.verdict === 'pending_6c')).toBe(true);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6c').length).toBe(12);
    // the 6a split: W213 / W224 and their chains are 6b's; W270 / W271 and theirs 6c's
    const wave = (id: string) => PARTNER6_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.wave;
    for (const id of ['W213', 'W224', 'W2921', 'W2925', 'W2987', 'W2993']) expect([id, wave(id)]).toEqual([id, '6b']);
    for (const id of ['W270', 'W271', 'W2960', 'W2966', 'W2967', 'W2969']) expect([id, wave(id)]).toEqual([id, '6c']);
    expect(fs.existsSync(CANON)).toBe(true);
    for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('ONE canon chain, TWO entries (query states of their pages); W2901–W2903 recorded exactly once, on W260; W261\'s entry carries files: [] and returns to W261', () => {
    expect(PARTNER6_CHAINS.map((c) => [c.id, c.wave, c.page, c.param, c.states, c.files, c.statement])).toEqual([
      ['settlement_act', '6a', '/insurer/settlements', 'act', ['confirm', 'success', 'failure'], ['W2901', 'W2902', 'W2903'], 'partner6.settlements.statement'],
      ['settlement_detail_act', '6a', '/insurer/settlements/[id]', 'act', ['confirm', 'success', 'failure'], [], 'partner6.settlement.statement'],
    ]);
    const all = PARTNER6_CHAINS.flatMap((c) => c.files);
    expect(all.length).toBe(3); expect(new Set(all).size).toBe(3);
    for (const id of all) expect([id, PARTNER6_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.verdict]).toEqual([id, 'DECOR']);
    // every DECOR file of 6a is some chain's file
    for (const f of PARTNER6_CANON_FILES.filter((x) => x.verdict === 'DECOR')) expect([f.file, all.includes(f.file.slice(0, f.file.indexOf('-')))]).toEqual([f.file, true]);
    expect([chain6State('settlement_act', { act: 'confirm' }), chain6State('settlement_act', { act: 'release' }), chain6State('settlement_act', { export: 'confirm' }), chain6State('settlement_act', undefined)])
      .toEqual(['confirm', null, null, null]);
    expect(chain6State('settlement_detail_act', { act: ['failure', 'confirm'] })).toBe('failure');
    expect(chain6ById('settlement_detail_act').surface).toBe('settlement_detail_act');
  });
  it('every refusal / chain / page key exists in en, hi and gu with the same placeholders; every English refusal says no; every 6a surface prints at least one', () => {
    const keys = [...PARTNER6_REFUSALS.map((r) => r.key), ...PARTNER6_CHAINS.flatMap(chainKeys), ...PARTNER6_CHAINS.map((c) => c.statement),
      'partner6.subnav.settlements', 'partner6.settlements.paidNone', 'partner6.refused.title', 'partner6.chain.back', 'partner3.retry', 'partner3.asOf'];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const r of PARTNER6_REFUSALS) expect([r.id, SAYS_NO.test(en[r.key])]).toEqual([r.id, true]);
    expect(new Set(PARTNER6_REFUSALS.map((r) => r.id)).size).toBe(PARTNER6_REFUSALS.length);
    for (const s of SURFACES_6A) expect([s, partner6RefusalKeys(s).length > 0]).toEqual([s, true]);
    for (const r of PARTNER6_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((x) => SURFACES_6A.includes(x))]).toEqual([r.id, true, true, true, true]);
      expect([r.id, /^partner6\.refusal\.|^partner3\.refusal\.|^partner4\.refusal\./.test(r.key)]).toEqual([r.id, true]);
    }
    // no 6b / 6c surface carries a refusal yet (declared, not built)
    for (const s of ['consents', 'regulatory', 'notifications', 'notification_prefs', 'consents_export', 'notification_form'] as const) expect([s, partner6RefusalKeys(s)]).toEqual([s, []]);
  });
  it('the reused keys are reused BY KEY — each is a key the earlier registry itself prints — and PARTNER-4\'s lender-worded chainAudit is NOT reused', () => {
    const reused = PARTNER6_REFUSALS.filter((r) => !r.key.startsWith('partner6.')).map((r) => r.key).sort();
    expect(reused).toEqual(['partner3.refusal.namedHolders', 'partner3.refusal.payingChip', 'partner3.refusal.payoutBatch', 'partner3.refusal.payoutLink',
      'partner4.refusal.chainOnCall', 'partner4.refusal.planSettings', 'partner4.refusal.platformRoles']);
    const earlier = new Set([...PARTNER3_REFUSALS.map((r) => r.key), ...PARTNER4_REFUSALS.map((r) => r.key)]);
    for (const k of reused) expect([k, earlier.has(k)]).toEqual([k, true]);
    expect(PARTNER6_REFUSALS.some((r) => r.key === 'partner4.refusal.chainAudit')).toBe(false);
    // "Release today's run" reuses 3a's payout_batch / paying_chip (brief 6a-1); W2902's zero-sum is refused with its OWN sentence
    expect(PARTNER6_REFUSALS.find((r) => r.id === 'release_run')?.key).toBe('partner3.refusal.payoutBatch');
    expect(PARTNER6_REFUSALS.find((r) => r.id === 'zero_sum')).toMatchObject({ key: 'partner6.refusal.zeroSum', surfaces: ['settlement_act', 'settlement_detail_act'] });
    // 3a's payout-link sentence no longer says "no settlement page exists" — this wave built one (it says no SETTLEMENT exists)
    for (const c of [en, hi, gu]) expect(c['partner3.refusal.payoutLink'].length).toBeGreaterThan(20);
    expect(en['partner3.refusal.payoutLink']).toBe('No payout is linked to any claim, and no settlement exists for a claim.');
    expect(/page/i.test(en['partner3.refusal.payoutLink'])).toBe(false);
  });
  it('the refusals the brief names (E5) are registered on the page that prints them', () => {
    const on = (id: string) => PARTNER6_REFUSALS.find((r) => r.id === id)?.surfaces ?? [];
    for (const id of ['approved_to_paid', 'release_run', 'ready_to_pay', 'paid_year', 'failed_transfers', 'disputes', 'claim_row', 'sums_verified', 'payout_link',
      'public_check', 'daily_job', 'reassembles', 'finance_role', 'plan_settings']) expect([id, on(id).includes('settlements')]).toEqual([id, true]);
    for (const id of ['named_heading', 'decider_names', 'claim_file', 'whole_chain', 'survey_details', 'event_to_money', 'claimant_message', 'credit_offer',
      'recovery_notes', 'recorded_end_to_end', 'retention', 'not_at_risk', 'export_watermark', 'finance_role', 'plan_settings', 'payout_link']) expect([id, on(id).includes('settlement')]).toEqual([id, true]);
    for (const id of ['zero_sum', 'chain_on_call', 'chain_audit', 'release_run']) expect([id, on(id).includes('settlement_act'), on(id).includes('settlement_detail_act')]).toEqual([id, true, true]);
  });
  it('the DELTAs: W252 links to nothing here, FM omits the claim anchor, "PM" a span, the dead buttons, the [id] a claim id, every id the same page, the chain\'s Back, the split personas', () => {
    expect(PARTNER6_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['w252_links_nothing', 'common_nav_removed', 'not_yet_back', 'fm_omits_clm_anchor', 'fm_avatar_pm',
      'fm_dead_buttons', 'fm_chain_ids_6a', 'id_is_claim', 'every_id_same_page', 'chain_back_w260', 'detail_retry_no_trigger', 'counts_filed_window', 'split_personas']));
    expect(new Set(PARTNER6_DELTAS.map((d) => d.id)).size).toBe(PARTNER6_DELTAS.length);
    expect(SETTLEMENTS_REDIRECTS).toEqual({ '/settlements': '/insurer/settlements' });
  });
});

describe('PC-56 PARTNER-6a · i18n parity for partner6.*', () => {
  it('every partner6. key is in en, hi and gu — the same key set, none English-only, none empty, hi and gu not English copies', () => {
    const k = (c: Record<string, string>) => Object.keys(c).filter((x) => x.startsWith('partner6.')).sort();
    expect(k(en).length).toBe(65);
    expect(k(hi)).toEqual(k(en)); expect(k(gu)).toEqual(k(en));
    for (const key of k(en)) {
      for (const c of [en, hi, gu]) expect([key, typeof c[key] === 'string' && c[key].trim().length > 0]).toEqual([key, true]);
      expect([key, vars(hi[key])]).toEqual([key, vars(en[key])]); expect([key, vars(gu[key])]).toEqual([key, vars(en[key])]);
      expect([key, hi[key] !== en[key], gu[key] !== en[key], hi[key] !== gu[key]]).toEqual([key, true, true, true]);
    }
  });
  it('no "%" and no "₹" in any partner6. value, in any language (founder 6a-1: counts only)', () => {
    for (const c of [en, hi, gu]) for (const [key, v] of Object.entries(c)) {
      if (!key.startsWith('partner6.')) continue;
      expect([key, v.includes('%'), v.includes('₹')]).toEqual([key, false, false]);
    }
  });
});
