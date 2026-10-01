// apps/web-tenant/src/test/tenant8d-banners.spec.ts · PC-56 TENANT-8d · THE BANNERS — the console's helpers, and the
// catalogue promise that every key its pages can ask for exists ×3: every phase, state, placement (read from migration
// 0178), act, act refusal and slot refusal (read from the API's own lists), form field and review refusal (read from the
// API's own list), every refused-by-name sentence; the required languages are 0178's; and the house pattern.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CmsBannerActVerdict, CmsBannerView } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  BANNERS_HREF, BANNERS_MUTATE, BANNER_ACT_VALUES, BANNER_FIELDS, BANNER_FORM, BANNER_MUTATE, BANNER_PHASE_VALUES, BANNER_REVIEW_ROWS, BANNER_SLOT_HREF, BANNER_STATE_VALUES,
  BANNER_TEXT_PARTS, MAX_CARRIED_LENGTH_BANNER, NEW_BANNER_HREF, PLACEMENT_VALUES, REFUSED_BY_NAME, REQUIRED_LANGUAGES, actDoneKey, actLabelKey, bannerActHref, bannerFieldNames, bannerHref,
  bannersHref, bannersTransportState, chainBackHref, chainModuleKey, chainPath, chainTitleKey, chipHref, editBannerHref, editValues, formLanguages, headlineFor, isBannerAct, isDirection,
  isKnownPlacement, languagesCell, listHas, moveLabelKey, offeredActs, pageStateKey, phaseKey, placementKey, readBannerValues, refusedActs, refusedKey, shareOf, slotMoveHref, stateKey,
  textFieldName, verdictFor, windowText,
} from '../features/banners/banners';
import { fieldLabelKey, refusalKey } from '../features/forms/chain';
import { mutateRefusalKey } from '../features/mutate/chain';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const repo = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../..', rel), 'utf8');
const apiDomain = (f: string) => repo(`apps/api/src/modules/cms/domain/${f}`);
function apiList(src: string, constName: string): string[] {
  const i = src.indexOf(`${constName} = [`);
  if (i < 0) throw new Error(`${constName} not found`);
  return [...src.slice(i, src.indexOf('] as const', i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
}

describe('PC-56 TENANT-8d · routes', () => {
  it('every canon clickable has an href; filters are a GET URL; a filter change drops the cursor', () => {
    expect([BANNERS_HREF, NEW_BANNER_HREF, BANNER_SLOT_HREF]).toEqual(['/content/banners', '/content/banners/new', '/content/banners/slot']);
    expect(bannersHref()).toBe('/content/banners');
    expect(bannersHref({ phase: 'live', placement: 'home_hero', languageCode: 'gu' }, 'c1')).toBe('/content/banners?phase=live&placement=home_hero&languageCode=gu&cursor=c1');
    expect(chipHref({ phase: 'live', placement: 'wallet' }, 'placement', 'home_hero')).toBe('/content/banners?phase=live&placement=home_hero');
    expect(chipHref({ phase: 'live', placement: 'wallet' }, 'phase', null)).toBe('/content/banners?placement=wallet');
    expect(bannerHref('b 1')).toBe('/content/banners/b%201'); expect(editBannerHref('b1')).toBe('/content/banners/b1/edit');
    expect(bannerActHref('b1', 'pause')).toBe('/content/banners/b1/act?step=confirm&act=pause');
    expect(slotMoveHref('b1', 'up')).toBe('/content/banners/slot?step=confirm&id=b1&direction=up');
  });
  it('one screen hosts the two form chains', () => {
    expect([chainPath('banners'), chainPath('banner', 'b1'), chainPath('banner')]).toEqual(['/content/banners/new', '/content/banners/b1/edit', '/content/banners/new']);
    expect([chainBackHref('banners'), chainBackHref('banner', 'b1')]).toEqual(['/content/banners', '/content/banners/b1']);
    for (const c of ['banners', 'banner'] as const) { three(chainTitleKey(c)); three(chainModuleKey(c)); }
  });
  it('a transport failure is one of the canon\'s states — flagged off is not a load error', () => {
    expect(bannersTransportState('CMS_FORBIDDEN', 403)).toBe('restricted'); expect(bannersTransportState('X', 403)).toBe('restricted'); expect(bannersTransportState('FORBIDDEN')).toBe('restricted');
    expect(bannersTransportState('CMS_BANNER_NOT_FOUND', 404)).toBe('notFound');
    expect(bannersTransportState('NOT_FOUND', 404)).toBe('notEnabled'); expect(bannersTransportState('FEATURE_DISABLED')).toBe('notEnabled'); expect(bannersTransportState('X', 404)).toBe('notEnabled');
    expect(bannersTransportState('BOOM', 500)).toBe('error'); expect(bannersTransportState(null)).toBe('error');
    for (const s of ['notEnabled', 'restricted', 'notFound', 'error'] as const) three(pageStateKey(s));
  });
});

describe('PC-56 TENANT-8d · the form\'s values and what a row says', () => {
  it('the form offers en · hi · gu always, then the cooperative\'s own; three text fields per language', () => {
    expect(formLanguages(['mr', 'gu', 'ta', 'mr'])).toEqual(['en', 'hi', 'gu', 'mr', 'ta']); expect(formLanguages([])).toEqual(['en', 'hi', 'gu']);
    expect(bannerFieldNames(['gu']).slice(-3)).toEqual(['headline_gu', 'body_gu', 'cta_gu']); expect(bannerFieldNames(['gu', 'hi'])).toHaveLength(BANNER_FIELDS.length + 6);
    expect(textFieldName('cta', 'hi')).toBe('cta_hi'); expect(MAX_CARRIED_LENGTH_BANNER).toBe(7000);
  });
  it('checkbox lists are joined; every other field is its first non-blank value', () => {
    const names = bannerFieldNames(['gu']);
    expect(readBannerValues({ roles: ['farmer', ' worker ', 'farmer'], regions: 'r1,r2', placement: ['', 'home_hero', 'wallet'], headline_gu: '  શબ્દ ', body_gu: ' ', stray: 'x' }, names))
      .toEqual({ roles: 'farmer,worker', regions: 'r1,r2', placement: 'home_hero', headline_gu: 'શબ્દ' });
    expect(readBannerValues({ roles: ['a,b', 'b'] }, names)).toEqual({ roles: 'a,b' });
    expect([listHas('farmer,worker', 'worker'), listHas('farmer,worker', 'work'), listHas(undefined, 'x')]).toEqual([true, false, false]);
  });
  it('the edit chain starts from the banner as it stands — never a reason', () => {
    const v = { placement: 'home_hero', mediaId: 'm1', groupKey: 'kharif', targetUrl: 'https://a.example', audience: { roles: ['farmer'], regions: ['r1', 'r2'] },
      startsLocal: { date: '2026-07-01', time: '06:00' }, endsLocal: { date: '2026-07-20', time: '22:00' },
      texts: [{ languageCode: 'gu', headline: 'h', body: null, ctaLabel: 'c' }, { languageCode: 'en', headline: 'H', body: 'B', ctaLabel: null }] } as unknown as CmsBannerView;
    expect(editValues(v)).toEqual({ placement: 'home_hero', mediaId: 'm1', groupKey: 'kharif', targetUrl: 'https://a.example', roles: 'farmer', regions: 'r1,r2', startsDate: '2026-07-01', startsTime: '06:00', endsDate: '2026-07-20', endsTime: '22:00', headline_gu: 'h', cta_gu: 'c', headline_en: 'H', body_en: 'B' });
    expect(editValues({ ...v, groupKey: null, targetUrl: null, audience: { roles: [], regions: [] }, texts: [] } as unknown as CmsBannerView)).toEqual({ placement: 'home_hero', mediaId: 'm1', startsDate: '2026-07-01', startsTime: '06:00', endsDate: '2026-07-20', endsTime: '22:00' });
  });
  it('W173\'s cells: languages and "(en missing)"; the headline in the console\'s language, else a required one, else any', () => {
    expect(languagesCell(['gu', 'hi'], ['en'])).toEqual({ speaks: 'gu · hi', missing: 'en' }); expect(languagesCell([], [])).toEqual({ speaks: '', missing: null });
    const texts = [{ languageCode: 'mr', headline: 'M' }, { languageCode: 'hi', headline: 'H' }, { languageCode: 'gu', headline: 'G' }];
    expect(headlineFor(texts, 'gu')).toEqual({ text: 'G', lang: 'gu' }); expect(headlineFor(texts, 'en')).toEqual({ text: 'H', lang: 'hi' });
    expect(headlineFor([{ languageCode: 'mr', headline: 'M' }], 'en')).toEqual({ text: 'M', lang: 'mr' }); expect(headlineFor([], 'en')).toBeNull();
    expect([shareOf(1, 3), shareOf(2, 3), shareOf(0, 0)]).toEqual([33, 67, 0]);
    expect(windowText({ date: '2026-07-01', time: '06:00' }, { date: '2026-07-20', time: '22:00' })).toBe('2026-07-01 06:00 – 2026-07-20 22:00');
    expect([isKnownPlacement('wallet'), isKnownPlacement('old_spot'), isKnownPlacement(null)]).toEqual([true, false, false]);
  });
  it('acts: offered are buttons, refused print every reason; act and direction guards', () => {
    const acts: CmsBannerActVerdict[] = [{ act: 'activate', allowed: false, refusals: ['TEXT_MISSING'], to: 'active', missingLanguages: ['gu'] }, { act: 'archive', allowed: true, refusals: [], to: 'archived', missingLanguages: [] }];
    expect(offeredActs(acts).map((a) => a.act)).toEqual(['archive']); expect(refusedActs(acts).map((a) => a.act)).toEqual(['activate']);
    expect(verdictFor(acts, 'activate')?.missingLanguages).toEqual(['gu']); expect(verdictFor(acts, 'pause')).toBeNull();
    expect([isBannerAct('resume'), isBannerAct('deactivate'), isBannerAct(undefined), isDirection('down'), isDirection('left')]).toEqual([true, false, false, true, false]);
  });
});

describe('PC-56 TENANT-8d · the API\'s and the database\'s own lists — every key ×3', () => {
  it('phases, states, acts, form fields agree with the API', () => {
    expect(apiList(apiDomain('banner-window.ts'), 'BANNER_PHASES')).toEqual([...BANNER_PHASE_VALUES]);
    expect(apiList(apiDomain('banner.state.ts'), 'BANNER_STATES')).toEqual([...BANNER_STATE_VALUES]);
    expect(apiList(apiDomain('banner.state.ts'), 'BANNER_ACTS')).toEqual([...BANNER_ACT_VALUES]);
    expect(apiList(apiDomain('banner-review.ts'), 'BANNER_FORM_FIELDS')).toEqual([...BANNER_FIELDS]);
    expect(apiList(apiDomain('banner-review.ts'), 'BANNER_TEXT_PARTS')).toEqual([...BANNER_TEXT_PARTS]);
    expect([...apiList(apiDomain('banner-review.ts'), 'BANNER_REVIEW_ROWS'), ...apiList(apiDomain('banner-review.ts'), 'BANNER_DERIVED_ROWS')]).toEqual([...BANNER_REVIEW_ROWS]);
    expect(apiList(apiDomain('banner-rules.ts'), 'REQUIRED_LANGUAGES')).toEqual([...REQUIRED_LANGUAGES]);
  });
  it('0178 seeds the placements and requires the languages the console prints', () => {
    const mig = repo('db/migrations/0178_banners.sql');
    expect([...mig.matchAll(/\('cms_banner_placement',\s*'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...PLACEMENT_VALUES]);
    expect(/banner_required_languages\(\) RETURNS varchar\[\]\s*LANGUAGE sql IMMUTABLE AS \$\$ SELECT ARRAY\['en', 'hi', 'gu'\]/.test(mig)).toBe(true);
    for (const p of PLACEMENT_VALUES) three(placementKey(p));
  });
  it('every phase · state · act · move · refused-by-name sentence', () => {
    for (const p of BANNER_PHASE_VALUES) three(phaseKey(p));
    for (const s of BANNER_STATE_VALUES) three(stateKey(s));
    for (const a of BANNER_ACT_VALUES) { three(actLabelKey(a)); three(actDoneKey(a)); three(`mutate.banner.effect.${a}`); }
    for (const d of ['up', 'down'] as const) three(moveLabelKey(d));
    for (const r of REFUSED_BY_NAME) three(refusedKey(r));
    for (const m of ['create', 'update']) three(`form.banner.mode.${m}`);
    three('nav.banners');
  });
  it('every review refusal, act refusal and slot refusal the API can answer; every field and row label', () => {
    const review = apiList(apiDomain('banner-review.ts'), 'BANNER_REVIEW_REFUSALS');
    expect(review).toContain('MEDIA_NOT_YOURS'); expect(review).toContain('TEXT_REQUIRED_WHILE_ACTIVE');
    for (const r of [...review, 'TOO_LONG', 'VALUE_REJECTED']) three(refusalKey(BANNER_FORM, r));
    const acts = [...apiList(apiDomain('banner-acts.ts'), 'ACTIVATION_REFUSALS'), ...apiList(apiDomain('banner-acts.ts'), 'BANNER_ACT_REFUSALS')];
    expect(acts).toContain('TEXT_MISSING'); expect(acts).toContain('REFUSED_BY_DATABASE');
    for (const r of acts) three(mutateRefusalKey(BANNER_MUTATE, r));
    const slot = [...apiList(apiDomain('banner-slot.ts'), 'SLOT_MOVE_REFUSALS'), ...apiList(apiDomain('banner-slot.ts'), 'SLOT_ACT_REFUSALS')];
    expect(slot).toEqual(expect.arrayContaining(['AT_TOP', 'AT_BOTTOM', 'NOT_IN_SLOT', 'BANNER_ARCHIVED', 'NO_PERMISSION', 'REASON_REQUIRED', 'REASON_TOO_LONG']));
    for (const r of slot) three(mutateRefusalKey(BANNERS_MUTATE, r));
    for (const f of [...BANNER_FIELDS, ...BANNER_TEXT_PARTS, ...BANNER_REVIEW_ROWS]) three(fieldLabelKey(BANNER_FORM, f));
  });
});

describe('PC-56 TENANT-8d · the house pattern', () => {
  const files = [
    'app/content/banners/page.tsx', 'app/content/banners/loading.tsx', 'app/content/banners/new/page.tsx', 'app/content/banners/new/actions.ts', 'app/content/banners/[id]/page.tsx',
    'app/content/banners/[id]/edit/page.tsx', 'app/content/banners/[id]/act/page.tsx', 'app/content/banners/[id]/act/actions.ts', 'app/content/banners/slot/page.tsx',
    'app/content/banners/slot/actions.ts', 'components/BannerFormScreen.tsx',
  ].map((f) => [f, fs.readFileSync(path.join(__dirname, '..', f), 'utf8')] as const);
  it('no client JS; every write carries the key its page minted; no literal UI text outside the catalogue', () => {
    for (const [f, s] of files) {
      expect(`${f}:${/['"]use client['"]/.test(s)}`).toBe(`${f}:false`);
      expect(`${f}:${/\bon(Click|Change|Submit)=/.test(s)}`).toBe(`${f}:false`);
    }
    for (const [f, s] of files.filter(([f]) => /act\/page|slot\/page|BannerFormScreen/.test(f))) expect(`${f}:${s.includes('name="idempotencyKey" value={randomUUID()}')}`).toBe(`${f}:true`);
    for (const [f, s] of files.filter(([x]) => x.endsWith('.tsx'))) expect(`${f}:${(s.match(/>\s*[A-Z][a-z]+(?: [a-z]+){2,}\s*</g) ?? []).join('|')}`).toBe(`${f}:`);
    // every key a page asks for by literal exists ×3
    for (const [, s] of files) for (const m of s.matchAll(/t\.t\('([a-zA-Z0-9_.]+)'/g)) three(m[1]);
    // the canon's decorations are marked, never wired
    expect(files.find(([f]) => f === 'app/content/banners/page.tsx')![1]).toMatch(/data-decor/);
  });
  it('the words carry their language; the CSS this wave adds is logical (no left/right)', () => {
    const w174 = files.find(([f]) => f === 'app/content/banners/[id]/page.tsx')![1];
    expect(w174).toMatch(/className="kv-banner-words" lang=\{l\}/);
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles/globals.css'), 'utf8');
    const block = css.slice(css.indexOf('PC-56 TENANT-8d'));
    expect(block).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:/);
    expect(block).toMatch(/max-inline-size/); expect(block).toMatch(/border-inline-start/);
  });
});
