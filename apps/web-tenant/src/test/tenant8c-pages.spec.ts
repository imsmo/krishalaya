// apps/web-tenant/src/test/tenant8c-pages.spec.ts · PC-56 TENANT-8c · THE PAGES — the console's helpers, and the
// catalogue promise that every key its pages can ask for exists ×3: every kind, state, status, serving source, act, act
// refusal (read from the API's own list), form field and review refusal (read from the API's own list), FAQ topic and
// archive reason (read from migration 0177 — a second copy would agree exactly once), every refused-by-name sentence.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CmsPageActVerdict, CmsSlugView, CmsVersionView } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ARCHIVE_REASON_VALUES, FAQ_ACT_HREF, FAQ_HREF, FAQ_MUTATE, FAQ_MUTATE_FIELDS, FAQ_TOPIC_VALUES, MAX_CARRIED_LENGTH_PAGE, NEW_FAQ_HREF, NEW_PAGE_HREF, PAGES_HREF, PAGE_ACT_VALUES,
  PAGE_FIELDS, PAGE_FORM, PAGE_KIND_VALUES, PAGE_MUTATE, REFUSED_BY_NAME, SERVING_VALUES, SLUG_STATE_VALUES, actDoneKey, actLabelKey, archiveReasonKey, chainBackHref, chainIntent,
  chainModuleKey, chainPath, chainTitleKey, editPageHref, editValues, faqHref, faqMoveHref, groupByTopic, isDirection, isKnownArchiveReason, isKnownTopic, isPageAct, kindChipHref,
  kindKey, moveLabelKey, newPageHref, nextPublishFacts, offeredActs, pageActHref, pageHref, pageStateKey, pagesHref, pagesTransportState, refusedActs, refusedKey, servingKey,
  slugStateKey, statusKey, topicKey, untranslatedLanguages, verdictFor,
} from '../features/pages/pages';
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
const ver = (o: Partial<CmsVersionView> = {}): CmsVersionView => ({
  id: 'v1', version: 1, status: 'published', pageKind: 'static', defaultTitle: 'About', body: '# About', languageCode: 'gu', topic: null, sortOrder: 0, createdAt: null, publishedAt: null,
  archivedAt: null, archivedReason: null, authorName: null, publisherName: null, archiverName: null, editorName: null, authoredByYou: false, lastEditedByYou: false, acts: [], ...o,
});

describe('PC-56 TENANT-8c · routes', () => {
  it('every canon clickable has an href; filters are a GET URL; a filter change drops the cursor', () => {
    expect([PAGES_HREF, NEW_PAGE_HREF, FAQ_HREF, NEW_FAQ_HREF, FAQ_ACT_HREF]).toEqual(['/content/pages', '/content/pages/new', '/content/faq', '/content/faq/new', '/content/faq/act']);
    expect(pagesHref()).toBe('/content/pages');
    expect(pagesHref({ pageKind: 'policy', state: 'draft', languageCode: 'gu' }, 'about')).toBe('/content/pages?pageKind=policy&state=draft&languageCode=gu&cursor=about');
    expect(kindChipHref({ pageKind: 'policy', state: 'draft' }, 'help_article')).toBe('/content/pages?pageKind=help_article&state=draft');
    expect(kindChipHref({ pageKind: 'policy' }, null)).toBe('/content/pages');
    expect(pageHref('how to')).toBe('/content/pages/how%20to'); expect(editPageHref('about')).toBe('/content/pages/about/edit');
    expect(pageActHref('about', 'v 1', 'archive')).toBe('/content/pages/about/act?step=confirm&act=archive&id=v+1');
    expect(newPageHref()).toBe('/content/pages/new'); expect(newPageHref('about', 'static')).toBe('/content/pages/new?slug=about&pageKind=static');
    expect(faqHref()).toBe('/content/faq'); expect(faqHref({ topic: 'payments', state: 'draft' })).toBe('/content/faq?topic=payments&state=draft');
    expect(faqMoveHref('payout-when', 'up')).toBe('/content/faq/act?step=confirm&slug=payout-when&direction=up');
  });
  it('one screen hosts the three form chains', () => {
    expect([chainIntent('pages'), chainIntent('faq'), chainIntent('page')]).toEqual(['new', 'new', 'version']);
    expect([chainPath('pages'), chainPath('faq'), chainPath('page', 'about'), chainPath('page')]).toEqual(['/content/pages/new', '/content/faq/new', '/content/pages/about/edit', '/content/pages/new']);
    expect([chainBackHref('pages'), chainBackHref('faq'), chainBackHref('page', 'about')]).toEqual(['/content/pages', '/content/faq', '/content/pages/about']);
    for (const c of ['pages', 'page', 'faq'] as const) { three(chainTitleKey(c)); three(chainModuleKey(c)); }
  });
  it('a transport failure is one of the canon\'s states — flagged off is not a load error', () => {
    expect(pagesTransportState('CMS_FORBIDDEN', 403)).toBe('restricted'); expect(pagesTransportState('X', 403)).toBe('restricted');
    expect(pagesTransportState('CMS_PAGE_NOT_FOUND', 404)).toBe('notFound');
    expect(pagesTransportState('NOT_FOUND', 404)).toBe('notEnabled'); expect(pagesTransportState('FEATURE_DISABLED')).toBe('notEnabled'); expect(pagesTransportState('X', 404)).toBe('notEnabled');
    expect(pagesTransportState('BOOM', 500)).toBe('error'); expect(pagesTransportState(null)).toBe('error');
    for (const s of ['notEnabled', 'restricted', 'notFound', 'error'] as const) three(pageStateKey(s));
  });
});

describe('PC-56 TENANT-8c · the editor and the FAQ, from the facts', () => {
  const view = (o: Partial<CmsSlugView> = {}): Pick<CmsSlugView, 'slug' | 'draft' | 'latest' | 'platform' | 'live'> => ({ slug: 'about', draft: null, latest: null, platform: null, live: null, ...o });
  it('the form starts from the open draft, else the latest version, else the platform\'s words — never a reason', () => {
    expect(editValues(view({ draft: ver({ version: 3, status: 'draft', body: '# d', topic: 'payments' }), latest: ver({ version: 3 }) }))).toEqual({ slug: 'about', pageKind: 'static', defaultTitle: 'About', body: '# d', languageCode: 'gu', topic: 'payments' });
    expect(editValues(view({ latest: ver({ version: 2, languageCode: null }) }))).toEqual({ slug: 'about', pageKind: 'static', defaultTitle: 'About', body: '# About' });
    expect(editValues(view({ platform: { id: 'p', version: 5, pageKind: 'static', defaultTitle: 'About K', body: '# p', languageCode: 'en' } }))).toEqual({ slug: 'about', pageKind: 'static', defaultTitle: 'About K', body: '# p' });
    expect(editValues(view())).toEqual({ slug: 'about' });
  });
  it('"publishing creates v3, v2 stays in history" — computed', () => {
    expect(nextPublishFacts(view({ draft: ver({ version: 3, status: 'draft' }), live: ver({ version: 2 }), latest: ver({ version: 3 }) }))).toEqual({ publishes: 3, staysInHistory: 2, nextVersion: 4 });
    expect(nextPublishFacts(view({ draft: ver({ version: 1, status: 'draft' }), latest: ver({ version: 1 }) }))).toEqual({ publishes: 1, staysInHistory: null, nextVersion: 2 });
    expect(nextPublishFacts(view({ live: ver({ version: 2 }), latest: ver({ version: 2 }) }))).toEqual({ publishes: null, staysInHistory: null, nextVersion: 3 });
    expect(nextPublishFacts(view())).toEqual({ publishes: null, staysInHistory: null, nextVersion: 1 });
  });
  it('offered acts are buttons, refused ones print their reasons', () => {
    const acts: CmsPageActVerdict[] = [{ act: 'publish', allowed: false, refusals: ['MAKER_IS_CHECKER'], to: 'published' }, { act: 'archive', allowed: true, refusals: [], to: 'archived' }];
    expect(offeredActs(acts).map((a) => a.act)).toEqual(['archive']); expect(refusedActs(acts).map((a) => a.act)).toEqual(['publish']);
    expect(verdictFor(acts, 'publish')?.refusals).toEqual(['MAKER_IS_CHECKER']); expect(verdictFor(acts, 'restore')).toBeNull();
    expect(isPageAct('restore')).toBe(true); expect(isPageAct('unpublish')).toBe(false); expect(isPageAct(null)).toBe(false);
  });
  it('the translations panel lists the cooperative\'s other languages (each refused by name)', () => {
    expect(untranslatedLanguages(['gu', 'hi', 'en'], 'gu')).toEqual(['hi', 'en']); expect(untranslatedLanguages(['gu'], null)).toEqual(['gu']);
  });
  it('the FAQ groups by topic in the API\'s order; a move direction is up or down', () => {
    expect(groupByTopic([{ topic: 'payments', s: 1 }, { topic: null, s: 2 }, { topic: 'payments', s: 3 }]).map((g) => [g.topic, g.items.length])).toEqual([['payments', 2], ['general', 1]]);
    expect(isDirection('up')).toBe(true); expect(isDirection('left')).toBe(false); expect(isDirection(undefined)).toBe(false);
    expect(isKnownTopic('payments')).toBe(true); expect(isKnownTopic('weather')).toBe(false); expect(isKnownArchiveReason('superseded')).toBe(true); expect(isKnownArchiveReason('x')).toBe(false);
    expect(MAX_CARRIED_LENGTH_PAGE).toBe(7000);
  });
});

describe('PC-56 TENANT-8c · every key a page can ask for exists ×3', () => {
  it('kinds · states · statuses · serving · acts · moves · refused-by-name', () => {
    for (const k of PAGE_KIND_VALUES) three(kindKey(k));
    for (const s of SLUG_STATE_VALUES) three(slugStateKey(s));
    for (const s of ['draft', 'published', 'archived']) three(statusKey(s));
    for (const s of SERVING_VALUES) three(servingKey({ source: s, version: 1 }));
    for (const a of PAGE_ACT_VALUES) { three(actLabelKey(a)); three(actDoneKey(a)); }
    for (const d of ['up', 'down'] as const) three(moveLabelKey(d));
    for (const r of REFUSED_BY_NAME) three(refusedKey(r));
    for (const m of ['new_page', 'new_version', 'edit_draft']) three(`form.page.mode.${m}`);
    three('nav.pages'); three('nav.faq');
  });
  it('the API\'s own lists: kinds, acts, act refusals, review refusals, form fields, FAQ refusals', () => {
    expect(apiList(repo('apps/api/src/modules/cms/domain/cms.events.ts'), 'PAGE_KINDS')).toEqual([...PAGE_KIND_VALUES]);
    expect(apiList(apiDomain('page-acts.ts'), 'PAGE_ACTS')).toEqual([...PAGE_ACT_VALUES]);
    for (const r of apiList(apiDomain('page-acts.ts'), 'PAGE_ACT_REFUSALS')) three(mutateRefusalKey(PAGE_MUTATE, r));
    const review = apiList(apiDomain('page-review.ts'), 'PAGE_REVIEW_REFUSALS');
    expect(review).toContain('SLUG_TAKEN');
    for (const r of [...review, 'TOO_LONG', 'VALUE_REJECTED']) three(refusalKey(PAGE_FORM, r));
    const fields = apiList(apiDomain('page-review.ts'), 'PAGE_FORM_FIELDS');
    expect(fields).toEqual([...PAGE_FIELDS]);
    for (const f of [...fields, ...apiList(apiDomain('page-review.ts'), 'PAGE_DERIVED_ROWS'), 'question', 'answer']) three(fieldLabelKey(PAGE_FORM, f));
    const faq = repo('apps/api/src/modules/cms/domain/faq-order.ts');
    for (const r of [...apiList(faq, 'FAQ_MOVE_REFUSALS'), 'NO_PERMISSION', 'NOT_FAQ', 'REASON_REQUIRED', 'REASON_TOO_LONG']) three(mutateRefusalKey(FAQ_MUTATE, r));
    expect([...FAQ_MUTATE_FIELDS]).toEqual(['slug', 'direction', 'reason']);
  });
  it('the vocabularies 0177 seeds: every FAQ topic and archive reason has its sentence ×3', () => {
    const mig = repo('db/migrations/0177_pages.sql');
    const codes = (type: string) => [...mig.matchAll(new RegExp(`\\('${type}',\\s*'([a-z_]+)'`, 'g'))].map((m) => m[1]);
    expect(codes('cms_faq_topic')).toEqual([...FAQ_TOPIC_VALUES]);
    expect(codes('cms_page_archive_reason')).toEqual([...ARCHIVE_REASON_VALUES]);
    for (const c of FAQ_TOPIC_VALUES) three(topicKey(c));
    for (const c of ARCHIVE_REASON_VALUES) three(archiveReasonKey(c));
  });
});

describe('PC-56 TENANT-8c · the house pattern', () => {
  const files = [
    'app/content/pages/page.tsx', 'app/content/pages/new/page.tsx', 'app/content/pages/new/actions.ts', 'app/content/pages/[slug]/page.tsx', 'app/content/pages/[slug]/edit/page.tsx',
    'app/content/pages/[slug]/act/page.tsx', 'app/content/pages/[slug]/act/actions.ts', 'app/content/faq/page.tsx', 'app/content/faq/new/page.tsx', 'app/content/faq/act/page.tsx',
    'app/content/faq/act/actions.ts', 'components/PageFormScreen.tsx',
  ].map((f) => [f, fs.readFileSync(path.join(__dirname, '..', f), 'utf8')] as const);
  it('no client JS; every write carries the key its page minted; no literal UI text outside the catalogue', () => {
    for (const [f, s] of files) {
      expect(`${f}:${/['"]use client['"]/.test(s)}`).toBe(`${f}:false`);
      expect(`${f}:${/\bon(Click|Change|Submit)=/.test(s)}`).toBe(`${f}:false`);
    }
    const minted = files.filter(([f]) => /act\/page|PageFormScreen/.test(f));
    for (const [f, s] of minted) expect(`${f}:${s.includes('name="idempotencyKey" value={randomUUID()}')}`).toBe(`${f}:true`);
    // a JSX text node that is a plain English word sequence would be a literal (Law 7)
    for (const [f, s] of files.filter(([x]) => x.endsWith('.tsx'))) expect(`${f}:${(s.match(/>\s*[A-Z][a-z]+(?: [a-z]+){2,}\s*</g) ?? []).join('|')}`).toBe(`${f}:`);
  });
  it('the CSS this wave adds is logical (no left/right)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles/globals.css'), 'utf8');
    const block = css.slice(css.indexOf('PC-56 TENANT-8c'));
    expect(block).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:/);
    expect(block).toMatch(/padding-inline/); expect(block).toMatch(/border-inline-start/);
  });
});
