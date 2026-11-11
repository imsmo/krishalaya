// apps/web-gov/src/test-render/gov-scheme-detail.render.test.tsx · PC-56 GOV-2b — W327 / W328 / W329 as the three tabs of `/schemes/[id]`:
//   identity and benefit — the published version read only (window and regions "as written", not checked at apply), the declared form
//     fields with their personal flag; every authoring act a link to its DECOR chain, Back to THIS scheme;
//   rules — the evaluator's five fields in words, land in ACRES AS STORED (never hectares, never rounded), "no condition" said plainly, a
//     stored condition the evaluator does not read named as not applied;
//   versions — number, status, published when, "published by a second person" as the read says (backfilled: not recorded), the diff the
//     read returns; "a newer draft exists" as a fact, never its content; "Send for approval" / "Start a draft" refused BY NAME.
// Q5-A verbatim on every tab; no money figure (the sentinel never printed); an inactive scheme labelled; every state; refusals ×3.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchemeDetailView } from '../components/gov2/SchemesViews';
import { gov2RefusalKeys, type SchemeTab } from '../features/gov2/refusals';
import type { SchemeState } from '../features/gov2/schemes';
import type { GovScheme } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';
import { DIFF_A3, DIFF_B4, DRAFT_SENTINEL, FALSE_2B, MONEY_SENTINEL, SCHEME_A, SCHEME_A_ID, SCHEME_B, SCHEME_B_ID, VERSIONS_A, VERSIONS_B } from './gov2b-fixtures';

const Q5 = 'Schemes are written by the platform\'s team, not from this console. Each version is drafted by one person and published by another.';
const CATS = { en, hi, gu } as const;
const TABS: SchemeTab[] = ['identity', 'rules', 'versions'];
const view = (tab: SchemeTab, s: GovScheme = SCHEME_A, cat: Record<string, string> = en, state: SchemeState = 'ok') => renderToStaticMarkup(
  <SchemeDetailView t={tr(cat)} state={state} id={s.id} tab={tab} scheme={s}
    versions={s.id === SCHEME_A_ID ? VERSIONS_A : VERSIONS_B} diff={s.id === SCHEME_A_ID ? DIFF_A3 : DIFF_B4} diffState="ok" />);
const field = (h: string, f: string) => text((h.match(new RegExp(`<div class="kv-facts__row" data-kv-field="${f}">[\\s\\S]*?</div>`)) ?? [''])[0]);

describe('PC-56 GOV-2b · /schemes/[id] — three tabs', () => {
  it('three tabs, the current one marked; Q5-A verbatim and the no-money fact on every tab; the list link', () => {
    for (const tab of TABS) {
      const h = view(tab);
      for (const x of TABS) expect(h).toContain(`href="/schemes/${SCHEME_A_ID}?tab=${x}"`);
      expect(h).toContain(`data-kv-tab="${tab}" aria-current="page"`);
      expect(text(h)).toContain(Q5);
      expect(h).toContain('href="/schemes" data-kv-nav="list"');
      expect(text(h)).toContain('This console shows no benefit money figure');
    }
  });
  it('Q1-A on every tab and language: the money sentinel and the draft sentinel are never printed; no false word visible', () => {
    for (const [l, cat] of Object.entries(CATS)) for (const tab of TABS) for (const s of [SCHEME_A, SCHEME_B]) {
      const h = view(tab, s, cat);
      expect([l, tab, s.code, h.includes(String(MONEY_SENTINEL)) || /24,?000/.test(h)]).toEqual([l, tab, s.code, false]);
      expect([l, tab, s.code, h.includes(DRAFT_SENTINEL)]).toEqual([l, tab, s.code, false]);
      expect([l, tab, s.code, FALSE_2B.test(visible(h))]).toEqual([l, tab, s.code, false]);
    }
  });
  it('an inactive scheme is labelled so on every tab', () => {
    for (const tab of TABS) expect(text(view(tab, SCHEME_B))).toContain('Inactive: a farmer cannot apply to it now.');
    expect(view('identity')).not.toContain('data-kv-inactive');
  });
});

describe('PC-56 GOV-2b · identity and benefit (W327) — read only', () => {
  it('the published fields as given; window and regions "as written", not checked at apply', () => {
    const h = view('identity');
    expect(field(h, 'code')).toContain('test_scheme_a'); expect(field(h, 'category')).toContain('Test Category');
    expect(field(h, 'benefit-type')).toContain('cash_transfer'); expect(field(h, 'instalments')).toMatch(/Number of instalments\s+2\s*$/);
    expect(field(h, 'version')).toContain('Version 3'); expect(field(h, 'published-at')).toContain('2026-10-01 05:00 UTC');
    expect(field(h, 'window')).toContain('opens: 2026-06-01 · closes: 2026-08-31');
    expect(field(h, 'window')).toContain('As written in the scheme\'s rules. It is not checked when a farmer applies.');
    expect(field(h, 'regions')).toContain('Test Region North'); expect(field(h, 'regions')).toContain('They are not checked when a farmer applies.');
    expect(field(h, 'documents')).toContain('Test Document');
  });
  it('the declared form fields with their personal flag; none declared said plainly', () => {
    const h = view('identity');
    expect(text(h)).toContain('Crop planned (crop_planned) — shown as given');
    expect(text(h)).toContain('Bank account (bank_account) — personal: masked when an official opens an application');
    expect(text(view('identity', SCHEME_B))).toContain('This version asks for no form field, so an official sees no form field of an application made under it.');
  });
  it('every authoring act is a link to its DECOR chain on THIS scheme — no form, no input, no button', () => {
    const h = view('identity');
    for (const d of ['edit', 'add-tier', 'add-document', 'save-draft']) {
      expect((h.match(new RegExp(`<li data-kv-decor="${d}"><a class="kv-link" href="([^"]+)"`)) ?? [])[1]).toBe(`/schemes/${SCHEME_A_ID}?tab=identity&amp;do=scheme&amp;act=review`);
    }
    expect(h).toContain(`<li data-kv-decor="copy"><a class="kv-link" href="/schemes/${SCHEME_A_ID}?tab=identity&amp;do=send&amp;act=confirm"`);
    expect(text(h)).toContain('Edit this scheme Not offered here: schemes are written by the platform\'s team.');
    for (const tab of TABS) { const x = view(tab); expect([tab, /<form|<input|<button|<select|<textarea/.test(x)]).toEqual([tab, false]); }
  });
});

describe('PC-56 GOV-2b · eligibility rules (W328) — the five fields in words', () => {
  it('each rule from the five fields, in the evaluator\'s order; land in ACRES as stored (never converted)', () => {
    const h = view('rules');
    const lines = (h.match(/<li data-kv-rule="[^"]+">[^<]*<\/li>/g) ?? []).map((x) => text(x).trim());
    expect(lines).toEqual(['Role held: one of farmer, fpo_member', 'Land held: at most 2.5 acres', 'Gender: female', 'Age: at least 18', 'Age: at most 60']);
    expect(text(h)).not.toMatch(/hectare|\bha\b|1\.01|1,01/i);
  });
  it('the honesty sentences: only five things; not run at apply; skipped when a detail is unknown', () => {
    const t = text(view('rules'));
    expect(t).toContain('The check reads only five things: role, land held (in acres), gender, minimum age and maximum age.');
    expect(t).toContain('This check is not run when a farmer applies.');
    expect(t).toContain('The land, gender and age conditions are not applied when the person\'s detail they need is not known.');
  });
  it('no rule: said plainly; a stored condition the check does not read is named as not applied', () => {
    expect(text(view('rules', SCHEME_B))).toContain('This scheme\'s rules set no condition: every person passes the check.');
    const odd = { ...SCHEME_B, published: { ...SCHEME_B.published!, rules: { landholding_max_acres: '3', roles: [] } } };
    const t = text(view('rules', odd));
    expect(t).toContain('Stored in a form the check does not read, so not applied: roles, landholding_max_acres');
    expect(t).not.toContain('Land held: at most');
  });
  it('the builder\'s acts are links to the DECOR chains on THIS scheme\'s rules', () => {
    const h = view('rules');
    for (const d of ['add-rule-plus', 'add-rule', 'save-draft']) expect(h).toContain(`<li data-kv-decor="${d}"><a class="kv-link" href="/schemes/${SCHEME_A_ID}?tab=rules&amp;do=rule&amp;act=review"`);
    expect(h).toContain(`<li data-kv-decor="remove"><a class="kv-link" href="/schemes/${SCHEME_A_ID}?tab=rules&amp;do=remove&amp;act=confirm"`);
  });
});

describe('PC-56 GOV-2b · versions (W329) — the history as read', () => {
  it('number, status, published when, second person as the read says (backfilled: not recorded)', () => {
    const h = view('versions');
    const r = (n: number) => text((h.match(new RegExp(`<tr data-kv-version="${n}"[\\s\\S]*?</tr>`)) ?? [''])[0]);
    expect(r(3)).toMatch(/Version 3\s+Published: in use now\s+2026-10-01 05:00 UTC\s+Yes: drafted by one person and published by another/);
    expect(r(2)).toMatch(/Version 2\s+Replaced by a later version\s+2026-07-01 05:00 UTC\s+Yes/);
    expect(r(1)).toMatch(/Version 1\s+Replaced by a later version\s+—\s+Not recorded: this version was recorded before drafting and publishing were tracked/);
    expect(h).toContain(`href="/schemes/${SCHEME_A_ID}?tab=versions&amp;v=2"`);
  });
  it('the diff exactly as the read returns it (rules in words, regions by name); first recorded version said plainly', () => {
    const h = view('versions'); const t = text(h);
    expect(t).toContain('What changed in version 3'); expect(t).toContain('Compared with version 2.');
    expect(h).toContain('data-kv-changes="3"');
    const c = (f: string) => text((h.match(new RegExp(`<tr data-kv-change="${f}"[\\s\\S]*?</tr>`)) ?? [''])[0]);
    expect(c('instalments')).toMatch(/Number of instalments\s+1\s+2/);
    expect(c('rules')).toMatch(/Land held: at most 2 acres[\s\S]*Land held: at most 2\.5 acres/);
    expect(c('regions')).toMatch(/Regions, as listed\s+—\s+Test Region North/);
    const b = text(view('versions', SCHEME_B));
    expect(b).toContain('No earlier version is recorded, so every field is shown as new.');
    expect(b).toContain('Versions before version 4 were not recorded.');
  });
  it('a newer draft is a fact, never its content; none → "no newer draft"', () => {
    expect(text(view('versions'))).toContain('A newer draft by the platform\'s team exists. Its content is not shown here.');
    expect(text(view('versions', SCHEME_B))).toContain('This scheme has no newer draft.');
  });
  it('"Back to the rules" is a tab link; "Send for approval" and "Start a draft" refused BY NAME on THIS scheme\'s versions', () => {
    const h = view('versions');
    expect(h).toContain(`href="/schemes/${SCHEME_A_ID}?tab=rules" data-kv-nav="back-to-rules"`);
    expect(h).toContain(`<li data-kv-decor="send"><a class="kv-link" href="/schemes/${SCHEME_A_ID}?tab=versions&amp;do=send&amp;act=confirm"`);
    expect(h).toContain(`<li data-kv-decor="start-draft"><a class="kv-link" href="/schemes/${SCHEME_A_ID}?tab=versions&amp;do=scheme&amp;act=review"`);
  });
  it('a diff that could not be read is said; the history still shows', () => {
    const h = renderToStaticMarkup(<SchemeDetailView t={tr(en)} state="ok" id={SCHEME_A_ID} tab="versions" scheme={SCHEME_A} versions={VERSIONS_A} diff={null} diffState="error" />);
    expect(text(h)).toContain('The changes for this version could not be read.'); expect(h).toContain('data-kv-versions="3"');
  });
});

describe('PC-56 GOV-2b · /schemes/[id] states and refusals', () => {
  it('not found (another authority\'s scheme answers the same) / off / refused / error with Retry → the re-read chain of THIS tab', () => {
    const nf = view('identity', SCHEME_A, en, 'not_found');
    expect(text(nf)).toContain('This scheme was not found among your authority\'s schemes.'); expect(nf).not.toContain('data-kv-tabs');
    expect(text(view('identity', SCHEME_A, en, 'off'))).toContain('The government console is switched off on this platform.');
    expect(text(view('identity', SCHEME_A, en, 'forbidden'))).toContain('Your role here does not include reading your authority\'s schemes.');
    expect(view('rules', SCHEME_A, en, 'error')).toContain(`href="/schemes/${SCHEME_A_ID}?tab=rules&amp;do=reread&amp;act=confirm" data-kv-retry=""`);
    expect(view('identity', SCHEME_B, en, 'error')).toContain(`href="/schemes/${SCHEME_B_ID}?tab=identity&amp;do=reread&amp;act=confirm"`);
  });
  it.each(Object.entries(CATS))('%s: every tab\'s refusals printed BY NAME', (_l, cat) => {
    const surface = { identity: 'scheme_identity', rules: 'scheme_rules', versions: 'scheme_versions' } as const;
    const n = { identity: 13, rules: 9, versions: 11 };
    for (const tab of TABS) {
      const t = text(view(tab, SCHEME_A, cat));
      const keys = gov2RefusalKeys(surface[tab]);
      expect([tab, keys.length]).toEqual([tab, n[tab]]);
      for (const k of keys) expect([tab, k, t.includes(cat[k])]).toEqual([tab, k, true]);
    }
  });
});
