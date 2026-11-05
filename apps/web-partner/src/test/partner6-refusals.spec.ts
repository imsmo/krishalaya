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
  CONSENTS_REDIRECTS, NOTIFICATIONS_REDIRECTS, PARTNER6_CANON_FILES, PARTNER6_CHAINS, PARTNER6_DELTAS, PARTNER6_REFUSALS, SETTLEMENTS_REDIRECTS, SURFACES_6A, SURFACES_6B, SURFACES_6C,
  chain6ById, chain6State,
  partner6RefusalKeys,
} from '../features/partner6/refusals';
import { PARTNER2_REFUSALS } from '../features/partner2/refusals';
import { PARTNER3_REFUSALS } from '../features/partner3/refusals';
import { PARTNER4_REFUSALS } from '../features/partner4/refusals';
import { PARTNER5_REFUSALS } from '../features/partner5/refusals';

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
  // PC-56 PARTNER-6b · NAMED UPDATE: 6b's 14 are decided (W213 / W224 BUILT (honest), the 12 chain files DECOR) — no `pending_6b` remains
  // PC-56 PARTNER-6c · NAMED UPDATE: 6c's 12 are decided (W270 / W271 BUILT (honest), W2960–W2963 REAL, W2964–W2969 DECOR) — no `pending_6c` remains; PARTNER-6 is 31 of 31
  it('31 files — the survey §C list exactly — each with ONE verdict: 6a = 5, 6b = 14, 6c = 12, all decided; each exists on disk', () => {
    const files = PARTNER6_CANON_FILES.map((f) => f.file);
    expect([...files].sort()).toEqual([...SURVEY_C].sort());
    expect(new Set(files).size).toBe(31);
    for (const f of PARTNER6_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6a').map((f) => [f.file.slice(0, f.file.indexOf('-')), f.verdict])).toEqual([
      ['W260', 'BUILT (read)'], ['W261', 'BUILT (honest)'], ['W2901', 'DECOR'], ['W2902', 'DECOR'], ['W2903', 'DECOR']]);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6b').map((f) => [f.file.slice(0, f.file.indexOf('-')), f.verdict])).toEqual([
      ['W213', 'BUILT (honest)'], ['W2921', 'DECOR'], ['W2922', 'DECOR'], ['W2923', 'DECOR'], ['W2924', 'DECOR'], ['W2925', 'DECOR'],
      ['W224', 'BUILT (honest)'], ['W2987', 'DECOR'], ['W2988', 'DECOR'], ['W2989', 'DECOR'], ['W2990', 'DECOR'], ['W2991', 'DECOR'], ['W2992', 'DECOR'], ['W2993', 'DECOR']]);
    expect(PARTNER6_CANON_FILES.filter((f) => !(f.verdict as string).startsWith('pending')).length).toBe(31);
    expect(PARTNER6_CANON_FILES.filter((f) => (f.verdict as string).startsWith('pending')).length).toBe(0);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6c').map((f) => [f.file.slice(0, f.file.indexOf('-')), f.verdict])).toEqual([
      ['W270', 'BUILT (honest)'], ['W271', 'BUILT (honest)'], ['W2960', 'REAL'], ['W2961', 'REAL'], ['W2962', 'REAL'], ['W2963', 'REAL'],
      ['W2964', 'DECOR'], ['W2965', 'DECOR'], ['W2966', 'DECOR'], ['W2967', 'DECOR'], ['W2968', 'DECOR'], ['W2969', 'DECOR']]);
    expect(PARTNER6_CANON_FILES.filter((f) => f.wave === '6c').length).toBe(12);
    // the 6a split: W213 / W224 and their chains are 6b's; W270 / W271 and theirs 6c's
    const wave = (id: string) => PARTNER6_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.wave;
    for (const id of ['W213', 'W224', 'W2921', 'W2925', 'W2987', 'W2993']) expect([id, wave(id)]).toEqual([id, '6b']);
    for (const id of ['W270', 'W271', 'W2960', 'W2966', 'W2967', 'W2969']) expect([id, wave(id)]).toEqual([id, '6c']);
    expect(fs.existsSync(CANON)).toBe(true);
    for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('ONE canon chain, TWO entries (query states of their pages); W2901–W2903 recorded exactly once, on W260; W261\'s entry carries files: [] and returns to W261', () => {
    // PC-56 PARTNER-6b · NAMED UPDATE: the registry now also holds 6b's four chains (pinned in their own describe below); this pin is 6a's
    expect(PARTNER6_CHAINS.filter((c) => c.wave === '6a').map((c) => [c.id, c.wave, c.page, c.param, c.states, c.files, c.statement])).toEqual([
      ['settlement_act', '6a', '/insurer/settlements', 'act', ['confirm', 'success', 'failure'], ['W2901', 'W2902', 'W2903'], 'partner6.settlements.statement'],
      ['settlement_detail_act', '6a', '/insurer/settlements/[id]', 'act', ['confirm', 'success', 'failure'], [], 'partner6.settlement.statement'],
    ]);
    const all = PARTNER6_CHAINS.filter((c) => c.wave === '6a').flatMap((c) => c.files);
    expect(all.length).toBe(3); expect(new Set(all).size).toBe(3);
    for (const id of all) expect([id, PARTNER6_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.verdict]).toEqual([id, 'DECOR']);
    // every DECOR file of 6a is some chain's file
    for (const f of PARTNER6_CANON_FILES.filter((x) => x.verdict === 'DECOR' && x.wave === '6a')) expect([f.file, all.includes(f.file.slice(0, f.file.indexOf('-')))]).toEqual([f.file, true]);
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
    for (const s of [...SURFACES_6A, ...SURFACES_6B, ...SURFACES_6C]) expect([s, partner6RefusalKeys(s).length > 0]).toEqual([s, true]);   // PC-56 PARTNER-6c · NAMED UPDATE: + the 6c surfaces
    // PC-56 PARTNER-6b · NAMED UPDATE: a refusal may sit on a 6a OR a 6b surface, and may reuse a PARTNER-2 or PARTNER-5 key (brief E3) — PC-56 PARTNER-6c · NAMED UPDATE: or a 6c surface
    for (const r of PARTNER6_REFUSALS) {
      expect([r.id, r.canon.length > 0, r.why.length > 0, r.surfaces.length > 0, r.surfaces.every((x) => SURFACES_6A.includes(x) || SURFACES_6B.includes(x) || SURFACES_6C.includes(x))]).toEqual([r.id, true, true, true, true]);
      expect([r.id, /^partner6\.refusal\.|^partner[2345]\.refusal\./.test(r.key)]).toEqual([r.id, true]);
    }
    // PC-56 PARTNER-6c · NAMED UPDATE: the 6c surfaces are BUILT now — the old "no 6c surface carries a refusal yet" pin is replaced by the line above (each prints ≥ 1)
  });
  it('the reused keys are reused BY KEY — each is a key the earlier registry itself prints — and PARTNER-4\'s lender-worded chainAudit is NOT reused', () => {
    const reused = PARTNER6_REFUSALS.filter((r) => !r.key.startsWith('partner6.')).map((r) => r.key).sort();
    // PC-56 PARTNER-6b · NAMED UPDATE: + six keys reused BY KEY on the lender's pages (brief E3): PARTNER-2's partner roles and report pack,
    // PARTNER-4a's score, PARTNER-4's export file and lender-worded zero-sum, PARTNER-5b's form review
    expect(reused).toEqual(['partner2.refusal.partnerRoles', 'partner2.refusal.reportPack', 'partner3.refusal.namedHolders', 'partner3.refusal.payingChip', 'partner3.refusal.payoutBatch', 'partner3.refusal.payoutLink',
      'partner4.refusal.chainOnCall', 'partner4.refusal.chainZeroSum', 'partner4.refusal.creditScore', 'partner4.refusal.exportFile', 'partner4.refusal.planSettings', 'partner4.refusal.platformRoles',
      'partner5.refusal.formReviewChecker']);
    const earlier = new Set([...PARTNER2_REFUSALS, ...PARTNER3_REFUSALS, ...PARTNER4_REFUSALS, ...PARTNER5_REFUSALS].map((r) => r.key));
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
    expect(k(en).length).toBe(198);   // PC-56 PARTNER-6b · NAMED UPDATE: 65 + 69 (the two pages, the four chains, 26 refusals) — PC-56 PARTNER-6c · NAMED UPDATE: + 64 (the two pages, the language act, three chains, 24 refusals)
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

// ══ PC-56 PARTNER-6b · CONSENT AND THE FILINGS THE PLATFORM DOES NOT MAKE (founder 6b-1 … 6b-5) ══════════════════════════════════════════════
describe('PC-56 PARTNER-6b · the lender\'s two honest pages and their four DECOR chains in the registry', () => {
  it('no `pending_6b` survives anywhere — not as a verdict, not in the registry\'s source, not in the verdict type', () => {
    expect(PARTNER6_CANON_FILES.some((f) => (f.verdict as string) === 'pending_6b')).toBe(false);
    const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'features', 'partner6', 'refusals.ts'), 'utf8')
      .split('\n').filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(src.includes('pending_6b')).toBe(false);
    expect(/P6B\(/.test(src)).toBe(false);
    // PC-56 PARTNER-6c · NAMED UPDATE: 31 decided + 0 pending (was 19 + 12 pending_6c)
    expect([PARTNER6_CANON_FILES.filter((f) => !(f.verdict as string).startsWith('pending')).length, PARTNER6_CANON_FILES.filter((f) => (f.verdict as string).startsWith('pending')).length]).toEqual([31, 0]);
  });
  it('the four 6b chains: files listed ONCE on the page their trigger lives on; the export and form chains carry the mailbox; every file DECOR', () => {
    expect(PARTNER6_CHAINS.filter((c) => c.wave === '6b').map((c) => [c.id, c.page, c.param, c.states, c.files, c.statement, !!c.mailbox, c.mailboxKey ?? null])).toEqual([
      ['consents_export', '/lender/consents', 'export', ['queued', 'ready'], ['W2921', 'W2922'], 'partner6.consents.statement', true, null],
      ['consents_act', '/lender/consents', 'act', ['confirm', 'success', 'failure'], ['W2923', 'W2924', 'W2925'], 'partner6.consents.statement', false, null],
      ['regulatory_form', '/lender/reports/regulatory', 'form', ['error', 'review', 'success', 'failure'], ['W2987', 'W2988', 'W2989', 'W2990'], 'partner6.regulatory.statement', true, 'partner6.regulatory.mailboxAsk'],
      ['regulatory_act', '/lender/reports/regulatory', 'act', ['confirm', 'success', 'failure'], ['W2991', 'W2992', 'W2993'], 'partner6.regulatory.statement', false, null],
    ]);
    const all = PARTNER6_CHAINS.filter((c) => c.wave === '6b').flatMap((c) => c.files);
    expect(all.length).toBe(12); expect(new Set(all).size).toBe(12);
    for (const id of all) expect([id, PARTNER6_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.verdict]).toEqual([id, 'DECOR']);
    // across all of PARTNER-6, every chain file is recorded exactly once
    const every = PARTNER6_CHAINS.flatMap((c) => c.files);
    expect(every.length).toBe(new Set(every).size);
    expect([chain6State('consents_export', { export: 'ready' }), chain6State('consents_export', { act: 'ready' }), chain6State('regulatory_form', { form: 'review' }),
      chain6State('regulatory_form', { form: 'confirm' }), chain6State('regulatory_act', { act: 'failure' }), chain6State('consents_act', { act: 'revoke' })])
      .toEqual(['ready', null, 'review', null, 'failure', null]);
    // the form chain has NO confirm state (a form chain has no confirm page — DELTA regulatory_form_retry_confirm)
    expect(chain6ById('regulatory_form').states).not.toContain('confirm');
  });
  it('every 6b chain sentence and page key exists ×3 with the same placeholders; every 6b surface prints at least one refusal', () => {
    const keys = [...PARTNER6_CHAINS.filter((c) => c.wave === '6b').flatMap(chainKeys), 'partner6.regulatory.mailboxAsk', 'partner4.export.notAvailable',
      'partner6.consents.statement', 'partner6.consents.noneYet', 'partner6.regulatory.statement', 'partner6.regulatory.fromReports', 'nav.consents'];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const s of SURFACES_6B) expect([s, partner6RefusalKeys(s).length > 0]).toEqual([s, true]);
  });
  it('the refusals the brief names are registered on the page that prints them', () => {
    const on = (id: string) => PARTNER6_REFUSALS.find((r) => r.id === id)?.surfaces ?? [];
    for (const id of ['consent_adjectives', 'bank_holds', 'provably', 'consent_registry_rows', 'status_chips', 'standard_term', 'covers_score', 'revocation_seconds',
      'decision_record', 'compliance_file', 'will_appear', 'arrive_with_applications', 'consents_no_error', 'partner_roles_consents', 'audit_mirror', 'export_registry', 'plan_settings'])
      expect([id, on(id).includes('consents')]).toEqual([id, true]);
    for (const id of ['prepared_filings', 'generate_pack', 'target_classification', 'land_kpi', 'gender_kpi', 'extracts_table', 'trace_to_evidence', 'packs_appear',
      'quarter_building', 'prior_packs', 'extract_marks', 'form_without_form', 'partner_roles_consents', 'plan_settings']) expect([id, on(id).includes('regulatory')]).toEqual([id, true]);
    for (const id of ['export_registry', 'export_file_6b']) expect([id, on(id).includes('consents_export')]).toEqual([id, true]);
    for (const s of ['consents_act', 'regulatory_act', 'regulatory_form'] as const) for (const id of ['chain_audit', 'chain_on_call', 'chain_zero_sum_6b']) expect([s, id, on(id).includes(s)]).toEqual([s, id, true]);
    for (const id of ['generate_pack', 'form_without_form', 'form_review_checker_6b', 'no_confirm_page']) expect([id, on(id).includes('regulatory_form')]).toEqual([id, true]);
    // reused BY KEY where one exists (brief E3)
    const key = (id: string) => PARTNER6_REFUSALS.find((r) => r.id === id)?.key;
    expect([key('partner_roles_consents'), key('generate_pack'), key('plan_settings'), key('covers_score'), key('export_file_6b'), key('chain_zero_sum_6b'), key('form_review_checker_6b')])
      .toEqual(['partner2.refusal.partnerRoles', 'partner2.refusal.reportPack', 'partner4.refusal.planSettings', 'partner4.refusal.creditScore', 'partner4.refusal.exportFile',
        'partner4.refusal.chainZeroSum', 'partner5.refusal.formReviewChecker']);
    // 6a's settlement-worded zero-sum is never printed on a lender chain
    expect(on('zero_sum').some((s) => SURFACES_6B.includes(s))).toBe(false);
  });
  it('the DELTAs the brief names; the /consents 307', () => {
    expect(PARTNER6_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['route_consents', 'consents_nav_lender', 'fm_named_rows_filter', 'fm_regulatory_td', 'fm_avatar_aj',
      'fm_dead_buttons_6b', 'w214_links_nothing', 'regulatory_form_back_to_edit', 'regulatory_form_retry_confirm', 'fm_chain_ids_6b', 'mutate_no_trigger_6b', 'chain_route_6b']));
    expect(new Set(PARTNER6_DELTAS.map((d) => d.id)).size).toBe(PARTNER6_DELTAS.length);
    expect(CONSENTS_REDIRECTS).toEqual({ '/consents': '/lender/consents' });
  });
});

// ══ PC-56 PARTNER-6c · WHAT THE PLATFORM TELLS A PARTNER PERSON (founder 6c-1 … 6c-6; doors Q5-A / Q7-A) ══════════════════════════════════════
describe('PC-56 PARTNER-6c · every partner person\'s two account pages, the REAL language chain and two DECOR chains in the registry', () => {
  it('no `pending_6c` survives anywhere — not as a verdict, not in the registry\'s source, not in the verdict type; 31 of 31 decided', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'features', 'partner6', 'refusals.ts'), 'utf8')
      .split('\n').filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(/\bpending_\w*/.test(src)).toBe(false);
    expect(/P6C\(/.test(src)).toBe(false);
    expect(new Set(PARTNER6_CANON_FILES.map((f) => f.verdict))).toEqual(new Set(['BUILT (read)', 'BUILT (honest)', 'REAL', 'DECOR']));
    expect(PARTNER6_CANON_FILES.filter((f) => f.verdict === 'REAL').map((f) => f.file.slice(0, f.file.indexOf('-')))).toEqual(['W2960', 'W2961', 'W2962', 'W2963']);
  });
  it('the three 6c chains: files listed ONCE on the page their trigger lives on; the form chain is REAL (the language act), no confirm state; the two act chains DECOR', () => {
    expect(PARTNER6_CHAINS.filter((c) => c.wave === '6c').map((c) => [c.id, c.page, c.param, c.states, c.files, c.statement, c.real ?? null, !!c.mailbox])).toEqual([
      ['notification_form', '/account/notifications/preferences', 'form', ['error', 'review', 'success', 'failure'], ['W2960', 'W2961', 'W2962', 'W2963'], 'partner6.notificationPrefs.statement', 'language', false],
      ['notification_act', '/account/notifications/preferences', 'act', ['confirm', 'success', 'failure'], ['W2964', 'W2965', 'W2966'], 'partner6.notificationPrefs.statement', null, false],
      ['notifications_act', '/account/notifications', 'act', ['confirm', 'success', 'failure'], ['W2967', 'W2968', 'W2969'], 'partner6.notifications.statement', null, false],
    ]);
    const verdictOf = (id: string) => PARTNER6_CANON_FILES.find((f) => f.file.startsWith(`${id}-`))?.verdict;
    for (const id of chain6ById('notification_form').files) expect([id, verdictOf(id)]).toEqual([id, 'REAL']);
    for (const c of ['notification_act', 'notifications_act'] as const) for (const id of chain6ById(c).files) expect([id, verdictOf(id)]).toEqual([id, 'DECOR']);
    // only ONE chain in all of PARTNER-6 is REAL; across PARTNER-6, every chain file is recorded exactly once, and every chain file is a chain's
    expect(PARTNER6_CHAINS.filter((c) => c.real).map((c) => c.id)).toEqual(['notification_form']);
    const every = PARTNER6_CHAINS.flatMap((c) => c.files);
    expect(every.length).toBe(25); expect(new Set(every).size).toBe(25);
    expect(chain6ById('notification_form').states).not.toContain('confirm');
    expect([chain6State('notification_form', { form: 'review' }), chain6State('notification_form', { form: 'confirm' }), chain6State('notification_act', { act: 'failure' }),
      chain6State('notifications_act', { act: 'read-all' }), chain6State('notifications_act', { form: 'confirm' })]).toEqual(['review', null, 'failure', null, null]);
  });
  it('every 6c chain sentence, page key and language key exists ×3 with the same placeholders; every 6c surface prints at least one refusal', () => {
    const keys = [...PARTNER6_CHAINS.filter((c) => c.wave === '6c').flatMap(chainKeys), 'partner6.notifications.statement', 'partner6.notificationPrefs.statement',
      'partner6.notifications.webhooksLink', 'partner6.notifications.prefsLink', 'partner6.notifications.markAllRead', 'partner6.notificationPrefs.backLink',
      'partner6.language.title', 'partner6.language.legend', 'partner6.language.submit', 'partner6.language.browserOnly', 'partner6.language.fallbackNote',
      'partner6.language.chosen', 'partner6.language.use', 'partner6.language.current', 'nav.notifications'];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const s of SURFACES_6C) expect([s, partner6RefusalKeys(s).length > 0]).toEqual([s, true]);
  });
  it('the refusals the brief names are registered on the page that prints them; the form chain prints the three refused triggers; the reused keys BY KEY', () => {
    const on = (id: string) => PARTNER6_REFUSALS.find((r) => r.id === id)?.surfaces ?? [];
    for (const id of ['same_engine', 'inbox_counters', 'inbox_items', 'other_channels', 'mark_all_read', 'expand_grouped', 'page_list', 'phone_alerts', 'delivery_log_here',
      'notifications_no_error', 'no_org_inbox', 'plan_settings']) expect([id, on(id).includes('notifications')]).toEqual([id, true]);
    for (const id of ['prefs_matrix', 'duty_lock', 'security_channels', 'event_count', 'quiet_window', 'daily_summary', 'save_prefs', 'defaults_state', 'prefs_no_error',
      'colleague_reach', 'template_parity', 'plan_settings']) expect([id, on(id).includes('notification_prefs')]).toEqual([id, true]);
    // founder 6c-5: Change time, Change window and Save preferences print their refusals IN the REAL chain's states; no confirm page is claimed
    for (const id of ['daily_summary', 'quiet_window', 'save_prefs', 'no_confirm_page', 'language_review_checker', 'language_no_audit', 'template_parity'])
      expect([id, on(id).includes('notification_form')]).toEqual([id, true]);
    // the REAL chain is never told "nothing was done, so nothing was written" (6a's chain_audit) — it has its own sentence
    expect(on('chain_audit').includes('notification_form')).toBe(false);
    for (const s of ['notification_act', 'notifications_act'] as const) for (const id of ['chain_audit', 'chain_on_call', 'chain_zero_sum_6b']) expect([s, id, on(id).includes(s)]).toEqual([s, id, true]);
    expect(on('mark_all_read')).toEqual(['notifications', 'notifications_act']);
    expect(on('prefs_no_error')).toEqual(['notification_prefs', 'notification_act']);
    const key = (id: string) => PARTNER6_REFUSALS.find((r) => r.id === id)?.key;
    expect([key('plan_settings'), key('chain_on_call'), key('chain_zero_sum_6b'), key('no_confirm_page')])
      .toEqual(['partner4.refusal.planSettings', 'partner4.refusal.chainOnCall', 'partner4.refusal.chainZeroSum', 'partner6.refusal.noConfirmPage']);
  });
  it('the DELTAs the brief names; the two /notifications 307s', () => {
    expect(PARTNER6_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['route_notifications', 'notifications_nav_account', 'fm_tabs_omitted', 'fm_avatar_pm_6c',
      'fm_chain_ids_6c', 'notification_form_back_to_edit', 'form_entry_review', 'mutate_no_trigger_6c', 'chain_route_6c', 'viewer_name_omitted']));
    expect(new Set(PARTNER6_DELTAS.map((d) => d.id)).size).toBe(PARTNER6_DELTAS.length);
    expect(NOTIFICATIONS_REDIRECTS).toEqual({ '/notifications': '/account/notifications', '/notifications/preferences': '/account/notifications/preferences' });
  });
});

// ══ PC-56 PARTNER-6c · THE PANEL-WIDE CHECK (founder 6c-6) — the partner panel's LAST registry closes the panel ═══════════════════════════════════
// The 222 partner canon files (`ls web-screens | grep -- '-partner-'`), each with EXACTLY ONE verdict across the six registries
// features/partner1 … partner6, every file on disk, and NO `pending_*` value anywhere in any partner registry's source (code, comments
// stripped). A file decided twice, a file decided nowhere, a census file no registry names, or a pending value left behind turns this red.
describe('PC-56 PARTNER-6c · the partner panel: 222 canon files, each with exactly one verdict across partner1 … partner6', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const regs = [1, 2, 3, 4, 5, 6].map((n) => [n, require(`../features/partner${n}/refusals`)[`PARTNER${n}_CANON_FILES`] as readonly { file: string; verdict: string; note: string }[]] as const);
  const all = regs.flatMap(([n, files]) => files.map((f) => ({ ...f, reg: n })));
  const census = fs.readdirSync(CANON).filter((f) => /-partner-/.test(f) && /\.html$/.test(f)).sort();
  it('the census is 222 partner canon files on disk; the six registries hold 45 + 50 + 26 + 39 + 31 + 31 = 222 rows', () => {
    expect(census.length).toBe(222);
    expect(regs.map(([n, files]) => [n, files.length])).toEqual([[1, 45], [2, 50], [3, 26], [4, 39], [5, 31], [6, 31]]);
    expect(all.length).toBe(222);
  });
  it('EVERY census file has EXACTLY ONE verdict across the six registries, and every registry file is a census file that exists on disk', () => {
    const counts = new Map<string, number>();
    for (const r of all) counts.set(r.file, (counts.get(r.file) ?? 0) + 1);
    expect([...counts.entries()].filter(([, n]) => n !== 1)).toEqual([]);
    expect([...counts.keys()].sort()).toEqual(census);
    for (const r of all) expect([r.reg, r.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(r.file), fs.existsSync(`${CANON}/${r.file}`), r.note.length > 0]).toEqual([r.reg, r.file, true, true, true]);
  });
  it('no verdict is pending: every one is a decided value', () => {
    const DECIDED = new Set(['BUILT', 'BUILT (read)', 'BUILT (read-only)', 'BUILT (honest)', 'BUILT (REAL)', 'REAL', 'PARITY-DECOR', 'DECOR']);
    expect(all.filter((r) => !DECIDED.has(r.verdict)).map((r) => [r.reg, r.file, r.verdict])).toEqual([]);
    expect(all.filter((r) => /pending/i.test(r.verdict))).toEqual([]);
  });
  it('no `pending_*` value survives in ANY partner registry\'s source (code only; a positive control proves the scan fires)', () => {
    const PENDING = /\bpending_\w*/;
    const code = (n: number) => fs.readFileSync(require('node:path').join(__dirname, '..', 'features', `partner${n}`, 'refusals.ts'), 'utf8')
      .split('\n').filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // the positive control: the scan fires on the shape every earlier wave's placeholder had, and not on a word that merely contains it
    expect(PENDING.test("verdict: 'pending_6c' as const")).toBe(true);
    expect(PENDING.test("export type V = 'DECOR' | 'pending_2b';")).toBe(true);
    expect(PENDING.test("{ id: 'docs_pending_state' }")).toBe(false);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const src = code(n);
      expect([n, src.length > 2000]).toEqual([n, true]);
      expect([n, (src.match(/\bpending_\w*/g) ?? [])]).toEqual([n, []]);
    }
  });
});
