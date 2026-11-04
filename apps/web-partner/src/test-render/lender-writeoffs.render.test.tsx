// apps/web-partner/src/test-render/lender-writeoffs.render.test.tsx · PC-56 PARTNER-5a · W222 (canon `lender/portfolio/writeoffs`) — the
// written-off count and outstanding with the "opened in this window" caveat; the statement and the lockdown note VERBATIM; every
// written-off loan as LOAN FACTS linking to its own page, with the caveat that the list is not windowed; Export DECOR, Retry into its
// chain, "View portfolio" real; empty / error / off. The load-bearing assertion: the view is HANDED a reason, a borrower's name, an actor
// and a write-off date (smuggled into the fixture) and prints NONE of them — and no canon death, herd, scheme or family appears anywhere.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderWriteoffsView } from '../components/partner5/LenderWriteoffsView';
import { partner5RefusalKeys } from '../features/partner5/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { COUNTS_5A, COUNTS_5A_NONE, FALSE_5A, SMUGGLED, WRITTEN_OFF } from './partner5a-fixtures';

type Props = Parameters<typeof LenderWriteoffsView>[0];
const r = (over: Partial<Props> = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <LenderWriteoffsView t={tr(cat)} lang="en" state="ok" counts={COUNTS_5A} items={WRITTEN_OFF} nextCursor={null} computedAt="2026-11-04T06:30:00.000Z" {...over} />);

describe('PC-56 PARTNER-5a · W222 written-off loans (render)', () => {
  it('the count and the bigint outstanding from the windowed counts read, under the window\'s label, with the "opened in this window" caveat', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-lender="writeoffs"');
    expect(html).toContain('data-kv-count="written_off"');
    expect(w).toContain(en['partner4.portfolio.fy'].replace('{fy}', '2026-27'));
    expect(w).toContain(en['partner5.writeoffs.count']);
    expect(en['partner5.writeoffs.count']).toMatch(/of the loans opened in this window/);
    expect(w).toContain('2 · ₹12,500.00');
    expect(html).toContain('data-kv-window-note="true"');
    expect(w).toContain(en['partner5.writeoffs.windowNote']);
    expect(html).toContain('data-kv-asof="2026-11-04T06:30:00.000Z"');
  });
  it('the statement and the lockdown note, VERBATIM in en and present in hi and gu, in every state but off', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'empty', 'error'] as const) {
      const w = text(r({ state, items: state === 'ok' ? WRITTEN_OFF : [], counts: state === 'error' ? null : COUNTS_5A }, cat));
      expect([state, w.includes(cat['partner5.writeoffs.statement'])]).toEqual([state, true]);
      expect([state, w.includes(cat['partner5.writeoffs.lockdownNote'])]).toEqual([state, true]);
    }
    expect(en['partner5.writeoffs.statement']).toMatch(/^A write-off on this platform is recorded by the organisation that serves the farmer and keeps no cause, date, committee or recovery;/);
    expect(en['partner5.writeoffs.lockdownNote']).toBe('No new write-off can be recorded on the platform until it keeps a record of who decided it, when and why, with a second person.');
  });
  it('every written-off loan as LOAN FACTS — reference linking to its own page, kind, the cooperative\'s public name, principal, outstanding, status, opened', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-table="writeoffs"');
    for (const l of WRITTEN_OFF) {
      expect(html).toContain(`data-kv-loan="${l.id}"`);
      expect(html).toContain(`href="/lender/portfolio/${l.id}"`);
      expect(w).toContain(`${l.id.slice(0, 8)}…`);
    }
    expect(w).toContain(en['partner4.kind.crop']);
    expect(w).toContain(en['partner4.kind.notRecorded']);                    // a kind the platform does not hold
    expect(w).toContain('Fixture Growers Collective');
    expect(w).toContain(en['partner1.fpoUnnamed']);
    expect(w).toContain('₹9,00,71,99,25,47,409.93');                         // a principal past 2^53, exact to the paisa
    expect((html.match(/kv-status--muted/g) ?? []).length).toBe(2);
    expect(w).toContain(en['partner4.status.written_off']);
    expect(w).toContain(en['partner5.writeoffs.colOpened']);
    expect(w).toContain(en['partner5.writeoffs.listNote']);
    expect(en['partner5.writeoffs.listNote']).toMatch(/whenever it was opened; it is not limited to the window above/);
  });
  it('NEVER a cause, a reason, a write-off date, an actor or a person — the smuggled fields never reach the markup; and no canon death, herd, scheme or family', () => {
    for (const cat of [en, hi, gu]) {
      const html = r({}, cat);
      for (const v of Object.values(SMUGGLED)) expect([v, html.includes(v)]).toEqual([v, false]);
      expect(html).not.toContain('0192d2c4-b0b0');                            // the smuggled borrower id
      expect(html).not.toContain('2026-10-21');                               // the smuggled write-off moment (and lastChangedAt)
      for (const canon of ['Borrower deceased', 'deceased', 'Herd loss', 'herd', 'PMFBY', 'family-assisted', 'disease', 'insurance lapsed', 'Bharat']) {
        expect([canon, new RegExp(canon, 'i').test(text(withoutRefusals(html)))]).toEqual([canon, false]);
      }
      expect(/borrowerUserId|writeOffReason|writtenOffBy|writtenOffAt|borrowerName/.test(html)).toBe(false);
    }
  });
  it('no "%" and no canon claim outside the refusal list, in any language; the W222 refusals all print', () => {
    for (const cat of [en, hi, gu]) for (const state of ['ok', 'empty', 'error', 'off'] as const) {
      const html = r({ state, items: state === 'ok' ? WRITTEN_OFF : [] }, cat);
      expect([state, percents(text(html))]).toEqual([state, 0]);
      expect([state, FALSE_5A.test(text(withoutRefusals(html)))]).toEqual([state, false]);
    }
    const keys = partner5RefusalKeys('writeoffs');
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect([k, text(r()).includes(en[k])]).toEqual([k, true]);
    expect(keys).toContain('partner4.refusal.cattleInsuranceRule');
  });
  it('Export is DECOR into its chain; Retry is the chain; "View portfolio" and the keyset pager are real links', () => {
    const html = r({ nextCursor: 'Y3Vyc29y' });
    expect(html).toContain('data-kv-decor="export"');
    expect(html).toContain('href="/lender/portfolio/writeoffs?export=queued"');
    expect(html).toContain('data-kv-real="portfolio"');
    expect(html).toContain('href="/lender/portfolio"');
    expect(html).toContain('href="/lender/portfolio/writeoffs?cursor=Y3Vyc29y"');
    expect(r({ state: 'error', counts: null, items: [] })).toContain('href="/lender/portfolio/writeoffs?act=confirm"');
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/lender\/portfolio\/writeoffs"/);
  });
  it('the states: empty ("no loan on your products is written off"), error, off — and never "lending is off"', () => {
    const empty = r({ state: 'empty', items: [], counts: COUNTS_5A_NONE });
    expect(empty).toContain('kv-empty-state');
    expect(text(empty)).toContain(en['partner5.writeoffs.empty.title']);
    expect(en['partner5.writeoffs.empty.title']).toMatch(/no loan on your products is written off/i);
    expect(r({ state: 'error', counts: null, items: [] })).toContain('role="alert"');
    const off = r({ state: 'off', counts: null, items: [] });
    expect(off).toContain('data-kv-state="off"');
    for (const s of ['ok', 'empty', 'error', 'off'] as const) expect(text(r({ state: s }))).not.toMatch(/lending is (switched )?off/i);
  });
});
