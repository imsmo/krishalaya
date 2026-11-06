// apps/web-ops/src/test-render/enwr-registry.render.test.tsx · PC-56 OPS-2b · W376 /warehouse/enwr/registry — A READ OF THE RECEIPT RECORDS (founder
// Q3-A, Q4-A, Q9-A, Q10-A). The fixtures CARRY the holder and the value the API sends — neither prints. Each row "recorded, not confirmed"; the status
// verbatim with the three unreachable said so; the quantity as recorded (an unparseable one is not shown); a row → its own page; the page-size select
// is the ONLY input; no total, no release / cancel; every state.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnwrRegistryView } from '../components/ops2/EnwrViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_2B, HOLDER_ID, RECEIPTS_2B, VALUE_MINOR } from './ops2b-fixtures';

type St = 'ok' | 'none' | 'forbidden' | 'off' | 'error';
const view = (cat: Record<string, string>, state: St = 'ok', next: string | null = null) =>
  renderToStaticMarkup(<EnwrRegistryView t={tr(cat)} lang="en" state={state} receipts={state === 'ok' ? RECEIPTS_2B : []} size={25} nextCursor={next} />);
const html = view(en);

describe('PC-56 OPS-2b · /warehouse/enwr/registry', () => {
  it('no holder and no value: the ids and amounts the API sent never reach the markup (Q9-A, Q4-A)', () => {
    expect(html.includes(HOLDER_ID)).toBe(false);
    expect(html.includes(VALUE_MINOR)).toBe(false); expect(html.includes('3,90,624')).toBe(false); expect(html.includes('390624')).toBe(false);
    expect(/holder|valuation/i.test(visible(html))).toBe(false);
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: every row carries the founder\'s "recorded, not confirmed"', (_l, cat) => {
    const h = view(cat);
    expect((h.match(/data-kv-label="recorded-not-confirmed"/g) ?? []).length).toBe(RECEIPTS_2B.length);
    expect(text(h)).toContain(cat['ops2.enwr.recordedNotConfirmed']);
  });
  it('the row: number → its own page, repository as recorded, quantity as recorded (bad one not shown), status verbatim', () => {
    for (const r of RECEIPTS_2B) expect(html).toContain(`href="/warehouse/enwr/${r.id}"`);
    expect(text(html)).toContain('NERL (as recorded; not checked with it)'); expect(text(html)).toContain('CCRL (as recorded; not checked with it)');
    expect(html).toContain('data-kv-quantity="62.600"'); expect(html).toContain('data-kv-quantity="6260.125"'); expect(html.includes('abc')).toBe(false);
    for (const s of ['issued', 'cancelled', 'released']) expect(html).toContain(`data-kv-status="${s}"`);
    expect(text(html)).toContain(en['ops2.enwr.quantityNote']);
  });
  it('the legend: three statuses can be recorded; pledged, partially_released and defaulted cannot happen here', () => {
    for (const s of ['issued', 'released', 'cancelled']) expect(html).toContain(`data-kv-reachable="${s}"`);
    for (const s of ['pledged', 'partially_released', 'defaulted']) expect(html).toContain(`data-kv-unreachable="${s}"`);
    expect(text(html)).toContain(en['ops2.enwr.legendUnreachable']);
  });
  it('the ONLY input is the GET page-size select (25 / 50); no release, cancel or other button', () => {
    expect((html.match(/<select/g) ?? []).length).toBe(1);
    expect((html.match(/<input|<textarea/g) ?? []).length).toBe(0);
    expect(html).toMatch(/<form method="get" action="\/warehouse\/enwr\/registry"/);
    expect(Array.from(html.matchAll(/<option value="(\d+)"/g)).map((m) => m[1])).toEqual(['25', '50']);
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(/release|cancel/i.test(Array.from(html.matchAll(/<button[^>]*>([^<]*)</g)).map((m) => m[1]).join(' '))).toBe(false);
  });
  it('no total, none of the canon\'s claims, keyset next link keeps the size', () => {
    expect(FALSE_2B.test(visible(html))).toBe(false);
    expect(/\bof \d/.test(visible(html))).toBe(false);
    expect(view(en, 'ok', 'Y3Vyc29y')).toContain('href="/warehouse/enwr/registry?size=25&amp;cursor=Y3Vyc29y"');
  });
  it('states: none / forbidden / off / error each say so; off has no select', () => {
    expect(view(en, 'none')).toContain('data-kv-empty="receipts"');
    expect(view(en, 'forbidden')).toContain('data-kv-error="forbidden"');
    expect(view(en, 'off')).toContain('data-kv-off="warehousing"'); expect(/<select/.test(view(en, 'off'))).toBe(false);
    expect(view(en, 'error')).toContain('data-kv-real="reread"');
  });
  it('the W376 refusals by name, and the DECOR export on THIS page', () => {
    for (const id of ['holder_name', 'receipt_value', 'pledged_loan', 'partly_released', 'goods_withdrawn', 'default_auction', 'register_total', 'repository_feed',
      'lender_scope', 'export_register', 'receipt_acts', 'holding_transfer', 'repository_confirmed']) expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    expect(html).toContain('href="/warehouse/enwr/registry?export=queued"');
  });
});
