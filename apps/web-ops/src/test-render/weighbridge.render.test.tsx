// apps/web-ops/src/test-render/weighbridge.render.test.tsx · PC-56 OPS-2a · W371 /warehouse/weighbridge — HONEST, READS NOTHING (founder Q6-A). The
// three facts ×3 (each proved in the code: `store(now)` takes no quantity, the receipt copies the booking's quantity, the fee reads it); zero inputs;
// no figure; slip, print, gross/tare/net, calibration, Legal Metrology, dual-confirm, manual reading, vehicle and supervisor reprint refused by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeighbridgeView } from '../components/ops2/IntakeViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { FALSE_2A } from './ops2a-fixtures';

const html = renderToStaticMarkup(<WeighbridgeView t={tr(en)} />);
describe('PC-56 OPS-2a · /warehouse/weighbridge is honest', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the three facts verbatim, the statement first', (_l, cat) => {
    const h = text(renderToStaticMarkup(<WeighbridgeView t={tr(cat)} />));
    for (const k of ['ops2.weighbridge.statement', 'ops2.weighbridge.store', 'ops2.weighbridge.quantity', 'ops2.weighbridge.fee']) expect([k, h.includes(cat[k])]).toEqual([k, true]);
    expect(h.indexOf(cat['ops2.weighbridge.statement'])).toBeLessThan(h.indexOf(cat['ops2.weighbridge.quantity']));
  });
  it('the facts are the brief\'s, word for word; the fee clause is conditional; no promise about the future', () => {
    expect([en['ops2.weighbridge.statement'], en['ops2.weighbridge.store'], en['ops2.weighbridge.quantity']]).toEqual(['This platform records no weighment.',
      'Marking goods stored records no weight.', 'The quantity on a booking and on its receipt is the quantity the depositor asked to store.']);
    expect(en['ops2.weighbridge.fee']).toMatch(/^If release were switched on, .* would be computed from /);
    expect(/\b(until|will|soon|later)\b/i.test(visible(html))).toBe(false);
  });
  it('zero inputs, no digit, none of the canon\'s claims', () => {
    expect(CONTROLS.test(html)).toBe(false);
    expect(/\d/.test(visible(html))).toBe(false);
    expect(FALSE_2A.test(visible(html))).toBe(false);
  });
  it('the refusals by name', () => {
    for (const id of ['weighbridge_slip', 'print_slip', 'gross_tare_net', 'net_carries', 'calibration', 'dual_confirm', 'vehicle_mismatch', 'supervisor_reprint', 'indicator_retry', 'search_invoices', 'wh_plan_settings'])
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
  it('the only links: the dashboard (REAL) and the two DECOR chains on this page', () => {
    expect(Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1])).toEqual(['/warehouse/dashboard', '/warehouse/weighbridge?export=queued', '/warehouse/weighbridge?act=confirm']);
  });
});
