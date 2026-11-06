// apps/web-ops/src/test-render/assay-record.render.test.tsx · PC-56 OPS-2b · W373 /warehouse/assay/certificate — ONE RECORDED ENTRY, titled "Assay
// record", never "certificate" (founder Q13-A). The label first; zero inputs; no number, lab, QR, verification, PDF or price; "Download PDF" is DECOR
// on THIS page; a link back to the booking's entries (W372).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssayRecordView } from '../components/ops2/AssayViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CONTROLS, percents, text, tr, visible } from './ops1a-fixtures';
import { ASSAYS_2B, BOOKING_ID, FALSE_2B } from './ops2b-fixtures';

const view = (cat: Record<string, string>, state: 'ok' | 'missing' | 'pick' | 'unavailable' | 'error' = 'ok', i = 0) =>
  renderToStaticMarkup(<AssayRecordView t={tr(cat)} lang="en" state={state} bookingId={BOOKING_ID} assay={state === 'ok' ? ASSAYS_2B[i] : null} />);
const html = view(en);

describe('PC-56 OPS-2b · /warehouse/assay/certificate is an Assay RECORD', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the h1 is the "Assay record" title, and the Q13-A label follows it', (_l, cat) => {
    const h = view(cat);
    expect(/<h1>([^<]*)<\/h1>/.exec(h)?.[1]).toBe(cat['ops2.assayRecord.title']);
    expect(text(h).indexOf(cat['ops2.assayRecord.title'])).toBeLessThan(text(h).indexOf(cat['ops2.assay.label']));
  });
  it('"certificate" never titles the page, and the visible text makes none of the canon\'s claims', () => {
    expect(/<h1>[^<]*certificat/i.test(html)).toBe(false);
    expect(FALSE_2B.test(visible(html).replace(en['ops2.assay.label'], ''))).toBe(false);
    expect(percents(text(html))).toBe(0);
  });
  it('the entry as recorded; the grade said to set no price; zero inputs in every state', () => {
    expect(text(html)).toContain('moisture = 11.50'); expect(text(html)).toContain('Test assay lab (as the warehouse typed it)');
    expect(text(view(en, 'ok', 1))).toContain(en['ops2.assayRecord.gradeRecorded']);
    for (const s of ['ok', 'missing', 'pick', 'unavailable', 'error'] as const) expect([s, CONTROLS.test(view(en, s))]).toEqual([s, false]);
  });
  it('links: back to the booking\'s entries (W372) and the DECOR "Download PDF" on THIS page', () => {
    const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1].replace(/&amp;/g, '&'));
    expect(hrefs).toEqual([`/warehouse/assay?booking=${BOOKING_ID}`, `/warehouse/assay/certificate?booking=${BOOKING_ID}&assay=${ASSAYS_2B[0].id}&export=queued`]);
  });
  it('the W373 refusals are printed by name (certificate title, number, verify code, PDF, accreditation, price, KYC, expiry, issuer)', () => {
    for (const id of ['certificate_title', 'certificate_number', 'verify_code', 'download_pdf', 'accredited_lab', 'price_birth', 'depositor_kyc', 'expiry_revoke', 'issuer_retry'])
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
});
