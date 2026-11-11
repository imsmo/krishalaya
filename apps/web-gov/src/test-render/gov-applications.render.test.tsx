// apps/web-gov/src/test-render/gov-applications.render.test.tsx · PC-56 GOV-2c — W330 (`/applications`) as a person sees it: applications
// to the authority's schemes as GOV-2a's read gives them (number, scheme, version, status, sent, decided), each row linking to
// /applications/[id]; no unsent application (the status filter cannot ask for one), no farmer, no organisation name; Q4-A's sentence exact
// and NO download offered of any kind; Q3-A's sentence; keyset paging by the API's cursor; every state; the refusals BY NAME in en / hi / gu.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApplicationsListView } from '../components/gov2/ApplicationsViews';
import { gov2RefusalKeys } from '../features/gov2/refusals';
import type { AppsState } from '../features/gov2/applications';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_OFFICER, text, tr, visible } from './gov1a-fixtures';
import { SCHEMES } from './gov2b-fixtures';
import { APP_1, APP_2, FALSE_2C, LIST, ORG_ID, ORG_SENTINEL, SCHEME_ID } from './gov2c-fixtures';

const Q4 = 'Applications cannot be downloaded from this console. Each one is opened here, and every opening is recorded.';
const Q3 = 'You see only what this scheme asks for. A farmer\'s personal details are hidden, and an application she has not sent is never shown.';
const CATS = { en, hi, gu } as const;
const view = (state: AppsState = 'ok', cat: Record<string, string> = en, over: Partial<React.ComponentProps<typeof ApplicationsListView>> = {}) =>
  renderToStaticMarkup(<ApplicationsListView t={tr(cat)} state={state} me={ME_OFFICER} items={state === 'empty' ? [] : LIST} schemes={SCHEMES} nextCursor="cursor-2" {...over} />);
const row = (h: string, id: string) => (h.match(new RegExp(`<tr data-kv-application="${id}"[\\s\\S]*?</tr>`)) ?? [''])[0];

describe('PC-56 GOV-2c · W330 /applications — read, never downloaded', () => {
  it('Q4-A verbatim (en) and printed whole in hi / gu; Q3-A verbatim', () => {
    const h = view();
    expect(text(h)).toContain(Q4); expect(text(h)).toContain(Q3); expect(h).toContain('data-kv-statement="gov2.q4"');
    for (const cat of [hi, gu]) expect(text(view('ok', cat))).toContain(cat['gov2.q4']);
  });
  it('NO download offered: no export / download button or link, no file chain link, in any language or state', () => {
    for (const [l, cat] of Object.entries(CATS)) for (const st of ['ok', 'empty', 'off', 'forbidden', 'error'] as const) {
      const h = view(st, cat);
      expect([l, st, /do=file|data-kv-(act|offer|decor)="(export|file|download)"/i.test(h)]).toEqual([l, st, false]);
      expect([l, st, /<(a|button)\b[^>]*>[^<]*(export|download|csv)/i.test(h)]).toEqual([l, st, false]);
    }
  });
  it('each row: the number (a link to /applications/[id]), scheme, version, status, sent, decided — as given; every row links', () => {
    const h = view();
    expect(h).toContain('data-kv-applications="3"');
    const a = row(h, APP_1);
    expect(a).toContain(`href="/applications/${APP_1}"`);
    expect(text(a)).toMatch(/0192D2C4\s+Test Scheme A \(test_scheme_a\)\s+Version 3\s+Being checked\s+2026-10-05 06:00 UTC\s+—/);
    expect(text(row(h, APP_2))).toMatch(/Approved\s+2026-10-05 06:00 UTC\s+2026-10-09 07:30 UTC/);
    expect((h.match(/data-kv-open="/g) ?? []).length).toBe(3);
  });
  it('no farmer and no organisation: neither the organisation id nor a name a careless mapping could carry is printed', () => {
    const h = view();
    expect(h).not.toContain(ORG_SENTINEL); expect(h).not.toContain(ORG_ID);
    expect(text(h)).toContain(en['gov2.refusal.noFarmer']);
  });
  it('the status filter offers the eight statuses of a SENT application, never an unsent one; the scheme filter names the authority\'s schemes', () => {
    const h = view();
    const sel = (h.match(/<select id="apps-status"[\s\S]*?<\/select>/) ?? [''])[0];
    expect((sel.match(/<option /g) ?? []).length).toBe(9);
    expect(sel).not.toMatch(/value="draft"/);
    expect(h).toContain(`<option value="${SCHEME_ID}">Test Scheme A (test_scheme_a)</option>`);
    expect(h).toContain('<form method="get" action="/applications"');
    expect(view('ok', en, { status: 'approved', scheme: SCHEME_ID })).toMatch(/<option value="approved" selected="">/);
  });
  it('paging is the API\'s cursor: "Next page" keeps the filters; "First page" only once paged; no page count', () => {
    const h = view('ok', en, { status: 'approved', scheme: SCHEME_ID });
    expect(h).toContain(`href="/applications?scheme=${SCHEME_ID}&amp;status=approved&amp;cursor=cursor-2" data-kv-page-next=""`);
    expect(h).not.toContain('data-kv-page-first');
    expect(view('ok', en, { cursor: 'cursor-1' })).toContain('href="/applications" data-kv-page-first=""');
    expect(view('ok', en, { nextCursor: null })).not.toContain('data-kv-page-next');
    expect(text(h)).not.toMatch(/Page \d+ of|Showing \d/);
  });
  it('empty / switched off / refused / error — said plainly; the error\'s Retry opens the re-read chain', () => {
    expect(text(view('empty'))).toContain('No sent application matches this view.');
    expect(text(view('off'))).toContain('The government console is switched off on this platform.');
    expect(text(view('forbidden'))).toContain('Your role here does not include reading applications.');
    const err = view('error');
    expect(err).toContain('href="/applications?do=reread&amp;act=confirm" data-kv-retry=""'); expect(err).not.toContain('data-kv-applications');
  });
  it.each(Object.entries(CATS))('%s: every list refusal BY NAME; no false word visible in any state', (_l, cat) => {
    const t = text(view('ok', cat));
    for (const k of gov2RefusalKeys('applications')) expect([k, t.includes(cat[k])]).toEqual([k, true]);
    for (const st of ['ok', 'empty', 'off', 'forbidden', 'error'] as const) expect([st, FALSE_2C.test(visible(view(st, cat)))]).toEqual([st, false]);
  });
});
