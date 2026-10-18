// apps/web-partner/src/test/partner1-refusals.spec.ts · PC-56 PARTNER-1a / 1b · founder D7 (survey E1) — the registry: all 45 PARTNER-1 canon
// files, each with ONE verdict (1a's 20 and 1b's 25 — none pending after PARTNER-1b); every refusal and chain sentence exists in en, hi AND
// gu; every English refusal says no; the DELTAs are recorded; the i18n parity spec extended to every `partner1.*` key (founder D6).
import * as fs from 'node:fs';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { PARTNER1_CANON_FILES, PARTNER1_CHAINS, PARTNER1_DELTAS, PARTNER1_REFUSALS, partner1RefusalKeys } from '../features/partner1/refusals';

const CANON = '/Users/sanjayodedra/Documents/Personal/farmer/Phase-1 all screen design/Krishalaya_Design_System/web-screens';
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('PC-56 PARTNER-1a · the PARTNER-1 canon registry', () => {
  it('45 files, unique, each with a verdict — 0 pending; 1a = 20 (3 BUILT, 3 BUILT (REAL), 6 PARITY-DECOR, 8 DECOR), 1b = 25 (3 BUILT, 1 BUILT (honest), 3 BUILT (REAL), 18 DECOR)', () => {
    const files = PARTNER1_CANON_FILES.map((f) => f.file);
    expect(files.length).toBe(45); expect(new Set(files).size).toBe(45);
    expect(PARTNER1_CANON_FILES.filter((f) => !['BUILT', 'BUILT (honest)', 'BUILT (REAL)', 'PARITY-DECOR', 'DECOR'].includes(f.verdict))).toEqual([]);
    expect(PARTNER1_CANON_FILES.filter((f) => (f.verdict as string) === 'pending_1b' || /PARTNER-1b$|pending_1b/.test(f.note))).toEqual([]);
    const a = PARTNER1_CANON_FILES.filter((f) => f.wave === '1a');
    expect(a.length).toBe(20);
    const count = (xs: typeof a, v: string) => xs.filter((f) => f.verdict === v).length;
    expect([count(a, 'BUILT'), count(a, 'BUILT (REAL)'), count(a, 'PARITY-DECOR'), count(a, 'DECOR')]).toEqual([3, 3, 6, 8]);
    const b = PARTNER1_CANON_FILES.filter((f) => f.wave === '1b');
    expect(b.length).toBe(25);
    expect([count(b, 'BUILT'), count(b, 'BUILT (honest)'), count(b, 'BUILT (REAL)'), count(b, 'DECOR')]).toEqual([3, 1, 3, 18]);
    const v = (f: string) => PARTNER1_CANON_FILES.find((x) => x.file.startsWith(`${f}-`))?.verdict;
    expect([v('W265'), v('W266'), v('W267'), v('W268')]).toEqual(['BUILT (honest)', 'BUILT', 'BUILT', 'BUILT']);
    for (const f of ['W2911', 'W2912', 'W2913']) expect([f, v(f)]).toEqual([f, 'BUILT (REAL)']);
    for (const f of ['W2907', 'W2908', 'W2909', 'W2910', 'W2970', 'W2971', 'W2972', 'W2973', 'W2974', 'W2975', 'W2976', 'W3017', 'W3018', 'W3019', 'W3020', 'W3021', 'W3022', 'W3023']) expect([f, v(f)]).toEqual([f, 'DECOR']);
    for (const f of PARTNER1_CANON_FILES) expect([f.file, /^W\d{3,4}-partner-[a-z0-9-]+\.html$/.test(f.file), f.note.length > 0]).toEqual([f.file, true, true]);
    if (fs.existsSync(CANON)) for (const f of files) expect([f, fs.existsSync(`${CANON}/${f}`)]).toEqual([f, true]);
  });
  it('every DECOR / PARITY-DECOR chain page is a state of its parent page, and every chain file is in the registry', () => {
    const chainFiles = PARTNER1_CHAINS.flatMap((c) => c.files);
    expect(chainFiles.length).toBe(14 + 18);
    expect(new Set(chainFiles).size).toBe(chainFiles.length);
    for (const id of chainFiles) expect([id, PARTNER1_CANON_FILES.some((f) => f.file.startsWith(`${id}-`) && (f.verdict === 'DECOR' || f.verdict === 'PARITY-DECOR'))]).toEqual([id, true]);
    // the REAL chains are not ChainNotice pages: the invite (W3006–W3008) and the revoke (W2911–W2913)
    for (const id of ['W3006', 'W3007', 'W3008', 'W2911', 'W2912', 'W2913']) expect(chainFiles).not.toContain(id);
  });
  it('every refusal / chain key exists in en, hi and gu with the same placeholders; every English refusal says no', () => {
    const keys = [...PARTNER1_REFUSALS.map((r) => r.key), ...PARTNER1_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
    for (const k of keys) {
      expect([k, typeof en[k], typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string', 'string']);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const r of PARTNER1_REFUSALS) expect([r.id, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnone\b|\bcannot\b/i.test(en[r.key])]).toEqual([r.id, true]);
    expect(new Set(PARTNER1_REFUSALS.map((r) => r.id)).size).toBe(PARTNER1_REFUSALS.length);
    for (const s of ['dashboard', 'dashboard_chain', 'settings', 'settings_form', 'help', 'help_ticket', 'help_retry',
      'keys', 'keys_form', 'webhooks', 'hooks_form', 'hooks_act', 'status', 'onboarding', 'onboarding_chain'] as const) expect([s, partner1RefusalKeys(s).length > 0]).toEqual([s, true]);
    expect(PARTNER1_REFUSALS.filter((r) => r.wave === '1b').length).toBe(34);
  });
  it('the DELTAs: the routes, the chain shape, the chain defects, the FM mis-classes', () => {
    expect(PARTNER1_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['dashboard_route', 'help_route', 'settings_route', 'chain_routes', 'chain_retry_defect', 'fm_numbering', 'fm_filter_class',
      'keys_route', 'webhooks_route', 'status_route', 'settlement_route', 'revoke_chain', 'fm_filter_replay', 'chain_retry_defect_1b', 'onboarding_back_defect', 'bilingual_subline']));
  });
  it('i18n parity (founder D6): every partner1.* key of en is in hi AND gu, non-empty, placeholders kept; hi and gu add nothing en lacks', () => {
    const fresh = Object.keys(en).filter((k) => k.startsWith('partner1.'));
    expect(fresh.length).toBe(200 + 235);
    for (const k of fresh) {
      expect([k, typeof hi[k] === 'string' && hi[k].length > 0, typeof gu[k] === 'string' && gu[k].length > 0]).toEqual([k, true, true]);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
    for (const k of [...Object.keys(hi), ...Object.keys(gu)]) expect([k, k in en]).toEqual([k, true]);
  });
});
