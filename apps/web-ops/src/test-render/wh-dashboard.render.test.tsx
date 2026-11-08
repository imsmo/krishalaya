// apps/web-ops/src/test-render/wh-dashboard.render.test.tsx · PC-56 OPS-2a · W370 /warehouse/dashboard — A READ OF THE BOOKINGS AT THE WAREHOUSES THE
// SIGNED-IN PERSON OPERATES (founder Q9-A, Q11-A, Q12-A, Q14-A). Through `readDashboard` and a fake client that answers like the API: a dropped `box`
// would answer the caller's OWN deposit (survey E1, mutant 8) — it never appears. No depositor name or id (the fixture carries the id); the founder's
// Q12-A sentence ×3; "Release is paused for everyone."; the GET status select the only input; no "of N", no total, no count; per-warehouse keyset
// next link; a row → /warehouse/[id]; the commodity's own name or "not available", never a product id; the switched-off / forbidden / error states.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WhDashboardView } from '../components/ops2/IntakeViews';
import { readDashboard } from '../features/ops2/intake';
import { OPS2_REFUSALS } from '../features/ops2/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { DEPOSITOR_ID, FALSE_2A, OPERATOR_ID, OWN_DEPOSIT, PRODUCT_1, PRODUCT_GONE, WAREHOUSE_ROWS, WH_1, WH_2, fakeIo } from './ops2a-fixtures';

const view = async (cat: Record<string, string>, q: { status?: string; warehouse?: string; cursor?: string } = {}, io = fakeIo()) => {
  const r = await readDashboard(io, q);
  return { html: renderToStaticMarkup(<WhDashboardView t={tr(cat)} lang="en" state={r.state} groups={r.groups} status={q.status} />), r, io };
};

describe('PC-56 OPS-2a · /warehouse/dashboard reads the warehouse\'s bookings — never the operator\'s own deposits, never a depositor', () => {
  it('E1: the reads are box mine, then box warehouse + warehouseId per warehouse; the operator\'s OWN deposit (what a dropped box answers) never appears', async () => {
    const { html, io } = await view(en);
    expect(io.calls.filter((c) => !c.startsWith('product:'))).toEqual(['warehouses:{"box":"mine","limit":100}',
      `bookings:{"box":"warehouse","warehouseId":"${WH_1}","limit":25}`, `bookings:{"box":"warehouse","warehouseId":"${WH_2}","limit":25}`]);
    expect(html.includes(OWN_DEPOSIT.id)).toBe(false);
    for (const row of WAREHOUSE_ROWS[WH_1]) expect(html).toContain(`data-kv-booking="${row.id}"`);
  });
  it('Q9-A: no depositor id (the body carries it), no operator id, no name column', async () => {
    const { html } = await view(en);
    for (const id of [DEPOSITOR_ID, OPERATOR_ID]) expect(html.includes(id)).toBe(false);
    expect(/farmer|depositor name|holder/i.test(visible(html))).toBe(false);
  });
  it('each row: reference → /warehouse/[id], status translated, the commodity\'s own name or "not available" (never its id), quantity with its unit, dates', async () => {
    const { html } = await view(en);
    const [a, b] = WAREHOUSE_ROWS[WH_1];
    expect(html).toContain(`href="/warehouse/${a.id}"`);
    expect(text(html)).toContain('Test commodity'); expect(text(html)).toContain('not available');
    for (const id of [PRODUCT_1, PRODUCT_GONE]) expect(html.includes(id)).toBe(false);
    expect(html).toContain('data-kv-quantity="62.600"'); expect(text(html)).toContain('62.600 quintal'); expect(text(html)).toContain('10.000 quintal');
    expect(html).toContain('data-kv-status="stored"'); expect(text(html)).toContain(en['wh.status.stored']); expect(text(html)).toContain(en['wh.status.requested']);
    expect(text(html)).toContain('TEST-WDRA-9 (as entered, not checked with WDRA)');
    void b;
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the founder\'s Q12-A sentence verbatim and "release is paused for everyone", in every state', async (_l, cat) => {
    for (const io of [fakeIo(), fakeIo({ warehousesFail: 404 }), fakeIo({ warehousesFail: 500 })]) {
      const { html } = await view(cat, {}, io);
      expect(text(html)).toContain(cat['ops2.whDash.newBooking']); expect(text(html)).toContain(cat['ops2.whDash.releasePaused']);
    }
    expect(en['ops2.whDash.newBooking']).toBe('A booking is the depositor\'s own request. She cannot yet make one on this platform.');
  });
  it('E7: the ONLY input is the GET status select (one select, one form, no input or textarea)', async () => {
    const { html } = await view(en);
    expect([(html.match(/<select/g) ?? []).length, (html.match(/<form/g) ?? []).length, (html.match(/<input|<textarea/g) ?? []).length]).toEqual([1, 1, 0]);
    expect(html).toMatch(/<form method="get" action="\/warehouse\/dashboard"/);
  });
  it('E3: no "of N", no total, no count, no figure the server did not send; none of the canon\'s claims', async () => {
    const { html } = await view(en, {}, fakeIo({ nextCursor: 'MjAyNnx4' }));
    expect(/\bof \d|Page \d|total|showing/i.test(visible(html))).toBe(false);
    expect(FALSE_2A.test(visible(html))).toBe(false);
  });
  it('keyset: a next link for THAT warehouse (its id and the server\'s cursor); the status filter keeps', async () => {
    const { html } = await view(en, { status: 'stored' }, fakeIo({ nextCursor: 'MjAyNnx4' }));
    expect(html).toContain(`href="/warehouse/dashboard?status=stored&amp;warehouse=${WH_1}&amp;cursor=MjAyNnx4"`);
    expect(html.includes(WAREHOUSE_ROWS[WH_1][1].id)).toBe(false);   // the requested one is filtered out by the SERVER (fixture), not the page
    const one = await view(en, { warehouse: WH_1, cursor: 'MjAyNnx4' });
    expect(one.io.calls.filter((c) => c.startsWith('bookings:'))).toEqual([`bookings:{"box":"warehouse","warehouseId":"${WH_1}","cursor":"MjAyNnx4","limit":25}`]);
  });
  it('"New booking" is DECOR (to the wh form chain, labelled not available); the weighbridge, stacking and register pages are REAL links; every W370 refusal listed', async () => {
    const { html } = await view(en);
    expect(html).toContain('href="/warehouse/dashboard?form=review"'); expect(text(html)).toContain('New booking: not available');
    for (const h of ['/warehouse/weighbridge', '/warehouse/stacking', '/warehouse/enwr/registry']) expect(html).toContain(`href="${h}"`);
    for (const r of OPS2_REFUSALS.filter((x) => x.surfaces.includes('wh_dashboard'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
  it('states: switched off (404), forbidden (403), error (Retry → the PARITY-DECOR chain), none (operates no warehouse), an empty warehouse', async () => {
    const off = (await view(en, {}, fakeIo({ warehousesFail: 404 }))).html;
    expect(off).toContain('data-kv-state="off"'); expect(/<select|data-kv-booking/.test(off)).toBe(false);
    expect((await view(en, {}, fakeIo({ warehousesFail: 403 }))).html).toContain('data-kv-error="forbidden"');
    const err = (await view(en, {}, fakeIo({ warehousesFail: 500 }))).html;
    expect(err).toContain('data-kv-error="bookings"'); expect(err).toContain('href="/warehouse/dashboard?act=confirm"');
    const none = await view(en, { warehouse: '0192d2c4-ffff-7000-8000-000000000000' });
    expect([none.r.state, none.html.includes('data-kv-empty="warehouses"')]).toEqual(['none', true]);
    expect((await view(en)).html).toContain(`data-kv-warehouse="${WH_2}"`);
    expect(text((await view(en)).html)).toContain(en['ops2.whDash.noBookings']);
  });
});
