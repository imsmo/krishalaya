// apps/web-partner/src/test-render/lender-queue.render.test.tsx · PC-56 PARTNER-4a · W206 THE LOAN QUEUE (canon `lender/queue`) — the
// consented applications and the FY counts of the lender's own book, and NOTHING the canon added on top: no response-timer column, no rating
// column, no security column, no borrower, no phone, no place. `docs_pending` is absent from the filters; `draft` is named as a state this
// axis never shows. Every refusal of the surface is printed by name. "Take next" is DECOR (a link into the chain, never a form).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderQueueView } from '../components/partner4/LenderQueueView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { APPLICATION_STATUSES_VISIBLE, REFUSED_APPLICATION_STATUSES } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { APPLICATIONS, COUNTS, FALSE_4A, IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';

type Props = Parameters<typeof LenderQueueView>[0];
const r = (state: Props['state'], cat: Record<string, string> = en, items = APPLICATIONS, status?: string, nextCursor: string | null = 'Y3Vyc29y') => renderToStaticMarkup(
  <LenderQueueView t={tr(cat)} lang="en" state={state} items={items} counts={COUNTS} box="review" status={status} nextCursor={nextCursor} computedAt="2026-10-28T06:30:00.000Z" />);

describe('PC-56 PARTNER-4a · W206 the loan queue (render)', () => {
  it('the queue prints the application facts and the FY counts, and no identity field reaches the markup', () => {
    const html = r('ok'); const w = text(html);
    expect(html).toContain('data-kv-lender="queue"');
    expect(html).toContain('data-kv-state="ok"');
    expect(w).toContain(en['partner4.queue.title']);
    expect(w).toContain(en['partner4.queue.lead']);
    for (const a of APPLICATIONS) expect(html).toContain(`data-kv-application="${a.id}"`);
    expect(html).toContain('href="/lender/queue/0192d2c4-a001-7000-8000-000000000001"');
    expect(w).toContain('0192d2c4…');                                  // the reference is the id's head, not a loan number
    expect(w).toContain('Fixture seasonal credit');
    expect(w).toContain(en['partner4.kind.notRecorded']);              // the application whose kind does not resolve
    expect(html).not.toMatch(IDENTITY_4A);
    expect(html).not.toContain('0192d2c4-7001-7000-8000-000000000001'); // the FPO's tenant id is never printed (survey F-10)
  });
  it('the FY counts are the four headline figures with the window label, the caveat and the as-of — and no percentage', () => {
    const html = r('ok'); const w = text(html);
    expect(html).toContain('data-kv-counts="book"');
    for (const id of ['servicing', 'opened', 'restructured', 'written_off']) expect(html).toContain(`data-kv-count="${id}"`);
    expect(w).toContain(en['partner4.portfolio.fy'].replace('{fy}', '2026-27'));
    expect(html).toContain('data-kv-window-note="true"');
    expect(html).toContain('data-kv-asof="2026-10-28T06:30:00.000Z"');
    expect(percents(w)).toBe(0);
  });
  it('the status filters are the SIX the machine can produce beside draft; `docs_pending` and `closed` are absent, and draft is named as never shown', () => {
    const html = r('ok');
    for (const s of APPLICATION_STATUSES_VISIBLE) expect([s, html.includes(`data-kv-status-filter="${s}"`)]).toEqual([s, true]);
    for (const s of REFUSED_APPLICATION_STATUSES) expect([s, html.includes(`data-kv-status-filter="${s}"`)]).toEqual([s, false]);
    expect(html).not.toContain('data-kv-status-filter="draft"');
    expect(html).toContain('data-kv-draft-note="true"');
    expect(text(html)).toContain(en['partner4.queue.draftNote']);
    expect(html).toContain('data-kv-box="review"'); expect(html).toContain('data-kv-box="all"');
  });
  it('NO response-timer, rating or security column exists to fill, and nothing on the screen is timed against the lender', () => {
    const html = r('ok'); const bare = text(withoutRefusals(html));
    expect(bare).not.toMatch(FALSE_4A);
    expect(html).toContain('data-kv-no-timer="true"');
    expect(text(html)).toContain(en['partner4.queue.noTimerNote']);
    // the table has exactly six columns, and none of them is the canon's three
    const headers = (html.match(/<th scope="col">/g) ?? []).length;
    expect(headers).toBe(6);
  });
  it('"Take next" is DECOR — a link into the chain, never a form; and the canon\'s dead "View portfolio" button is a REAL link', () => {
    const html = r('ok');
    expect(html).toContain('data-kv-decor="take-next"');
    expect(html).toContain('href="/lender/queue?act=confirm"');
    expect(html).not.toContain('<form');
    expect(html).toContain('data-kv-real="portfolio"');
    expect(html).toContain('href="/lender/portfolio"');
  });
  it('every refusal of the surface is printed BY NAME, in all three languages', () => {
    for (const cat of [en, hi, gu]) {
      const w = text(r('ok', cat));
      for (const k of partner4RefusalKeys('queue')) expect([k, w.includes(cat[k])]).toEqual([k, true]);
    }
  });
  it('the states: empty, filtered-empty, error, and the console switched off — never an outage word for a switch', () => {
    const empty = text(r('empty', en, []));
    expect(empty).toContain(en['partner4.queue.empty.title']);
    expect(empty).toContain(en['partner4.queue.empty.body']);
    expect(empty).not.toMatch(/unavailable|temporarily|outage/i);
    const filtered = text(r('empty', en, [], 'approved'));
    expect(filtered).toContain(en['partner4.queue.emptyFilter.title']);
    const err = r('error'); expect(err).toContain('role="alert"');
    expect(text(err)).toContain(en['partner4.queue.error.body']);
    expect(text(err)).not.toMatch(/unavailable|temporarily/i);
    const off = r('off');
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.title']);
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toMatch(/unavailable/i);
    expect(off).not.toContain('data-kv-counts');      // a switched-off page reads nothing and shows no figure
  });
  it('the keyset pager carries the opaque cursor and nothing else', () => {
    expect(r('ok')).toContain('href="/lender/queue?cursor=Y3Vyc29y"');
    expect(r('ok', en, APPLICATIONS, undefined, null)).not.toContain('data-kv-next');
  });
});
