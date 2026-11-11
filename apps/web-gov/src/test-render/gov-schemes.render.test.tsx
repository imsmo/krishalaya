// apps/web-gov/src/test-render/gov-schemes.render.test.tsx · PC-56 GOV-2b — W326 (`/schemes`) as a person sees it: the authority's schemes as
// GOV-2a's read gives them (name, code, category, benefit TYPE, instalment COUNT, the published version, active / inactive, the newer-draft
// FACT), each row linking to /schemes/[id]; Q5-A's sentence verbatim (en) and in hi / gu; no money figure (Q1-A — the sentinel the fixture
// carries is never printed), no "₹", "%", "AI", "Joint Director", "budget"; an inactive scheme labelled; a draft's content never printed;
// "Define a scheme" refused BY NAME (a link to its DECOR chain, no form); every state; the refusals BY NAME in en/hi/gu.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchemesListView } from '../components/gov2/SchemesViews';
import { gov2RefusalKeys } from '../features/gov2/refusals';
import type { SchemesState } from '../features/gov2/schemes';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_OFFICER, text, tr, visible } from './gov1a-fixtures';
import { DRAFT_SENTINEL, FALSE_2B, MONEY_SENTINEL, SCHEMES, SCHEME_A_ID, SCHEME_B_ID } from './gov2b-fixtures';

export const Q5 = 'Schemes are written by the platform\'s team, not from this console. Each version is drafted by one person and published by another.';
const CATS = { en, hi, gu } as const;
const view = (state: SchemesState = 'ok', cat: Record<string, string> = en, list = SCHEMES) =>
  renderToStaticMarkup(<SchemesListView t={tr(cat)} state={state} me={ME_OFFICER} schemes={list} />);
const row = (h: string, code: string) => (h.match(new RegExp(`<tr data-kv-scheme="${code}"[\\s\\S]*?</tr>`)) ?? [''])[0];

describe('PC-56 GOV-2b · W326 /schemes — the authority\'s schemes, read', () => {
  it('Q5-A verbatim in English, and the gu / hi sentence printed whole (both clauses)', () => {
    const h = view();
    expect(text(h)).toContain(Q5); expect(h).toContain('data-kv-statement="gov2.q5"');
    for (const cat of [hi, gu]) expect(text(view('ok', cat))).toContain(cat['gov2.q5']);
    expect(/પ્લેટફોર્મની ટીમ/.test(gu['gov2.q5']) && /કન્સોલમાંથી નહીં/.test(gu['gov2.q5']) && /એક વ્યક્તિ/.test(gu['gov2.q5']) && /બીજી વ્યક્તિ પ્રકાશિત/.test(gu['gov2.q5'])).toBe(true);
    expect(/प्लेटफ़ॉर्म की टीम/.test(hi['gov2.q5']) && /कंसोल से नहीं/.test(hi['gov2.q5']) && /एक व्यक्ति/.test(hi['gov2.q5']) && /दूसरा व्यक्ति प्रकाशित/.test(hi['gov2.q5'])).toBe(true);
  });
  it('each row: name (a link to /schemes/[id]), code, category, benefit type, instalment count, version, status — as given', () => {
    const h = view();
    expect(h).toContain('data-kv-schemes="2"');
    const a = row(h, 'test_scheme_a');
    expect(a).toContain(`href="/schemes/${SCHEME_A_ID}"`);
    expect(text(a)).toMatch(/Test Scheme A\s+test_scheme_a\s+Test Category\s+cash_transfer\s+2\s+Version 3/);
    expect(text(a)).toContain('Active');
    expect(row(h, 'test_scheme_b')).toContain(`href="/schemes/${SCHEME_B_ID}"`);
  });
  it('an inactive scheme is labelled so (and still listed)', () => {
    const b = row(view(), 'test_scheme_b');
    expect(b).toContain('data-kv-active="no"'); expect(b).toContain('data-kv-status="inactive"');
    expect(text(b)).toContain('Inactive: a farmer cannot apply to it now.');
    expect(text(b)).toMatch(/Test Scheme B\s+test_scheme_b\s+—\s+in_kind\s+—\s+Version 4/);
  });
  it('a newer draft is a FACT, never its content', () => {
    const h = view();
    expect(text(row(h, 'test_scheme_a'))).toContain('A newer draft by the platform\'s team exists. Its content is not shown here.');
    expect(row(h, 'test_scheme_b')).not.toContain('data-kv-newer-draft');
    expect(h).not.toContain(DRAFT_SENTINEL); expect(text(h)).not.toMatch(/\b9 acres\b/);
  });
  it('Q1-A: no money figure — the sentinel never printed; no ₹, %, AI, Joint Director, budget in what is visible (en/hi/gu, every state)', () => {
    for (const [l, cat] of Object.entries(CATS)) for (const st of ['ok', 'empty', 'off', 'forbidden', 'error'] as const) {
      const h = view(st, cat, st === 'empty' ? [] : SCHEMES);
      expect([l, st, FALSE_2B.test(visible(h))]).toEqual([l, st, false]);
      expect([l, st, /₹|%|\bAI\b|Joint Director|budget/i.test(text(h))]).toEqual([l, st, false]);
      expect([l, st, h.includes(String(MONEY_SENTINEL)) || /24,?000/.test(h)]).toEqual([l, st, false]);
    }
    expect(text(view())).toContain('This console shows no benefit money figure: a scheme shows its benefit type and number of instalments only.');
  });
  it('"Define a scheme" is refused BY NAME: a link to its DECOR chain (Back → /schemes), never a form or an input', () => {
    const h = view();
    expect(h).toContain('href="/schemes?do=define&amp;act=review"');
    expect(text(h)).toContain('Define a scheme Not offered here: schemes are written by the platform\'s team.');
    expect(h).not.toContain('<form'); expect(h).not.toContain('<input'); expect(h).not.toContain('<button');
  });
  it('empty / switched off / refused / error — said plainly; the error\'s Retry opens the re-read chain', () => {
    expect(text(view('empty', en, []))).toContain('No scheme on this platform is run by your authority yet.');
    expect(view('empty', en, [])).not.toContain('data-kv-schemes');
    expect(text(view('off'))).toContain('The government console is switched off on this platform.'); expect(view('off')).not.toContain('data-kv-schemes');
    expect(text(view('forbidden'))).toContain('Your role here does not include reading your authority\'s schemes.');
    const err = view('error');
    expect(text(err)).toContain('Only this page failed to load. Nothing was changed.');
    expect(err).toContain('href="/schemes?do=reread&amp;act=confirm" data-kv-retry=""'); expect(err).not.toContain('data-kv-schemes');
  });
  it.each(Object.entries(CATS))('%s: every list refusal printed BY NAME', (_l, cat) => {
    const t = text(view('ok', cat));
    const keys = gov2RefusalKeys('schemes');
    expect(keys.length).toBe(10);
    for (const k of keys) expect([k, t.includes(cat[k])]).toEqual([k, true]);
  });
});
