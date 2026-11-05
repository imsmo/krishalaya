// apps/web-ops/src/test-render/biometric-canon.render.test.tsx · PC-56 OPS-1b · W399 /canon/biometric — WHAT IS STORED, AND WHAT IS NOT (founder
// Q5-A, Q7-A): the stored list INCLUDES pictures of faces (profile photo, KYC selfie) and says erased ones are anonymised, not deleted; the AePS
// record's fields are those after Q7-A (no Aadhaar digit, no account link); no fingerprint or face pattern anywhere; no "template … device".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BiometricCanonView, BIO_SECTIONS } from '../components/ops1/FaceViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_1B, NONE, controls } from './ops1b-fixtures';

const html = renderToStaticMarkup(<BiometricCanonView t={tr(en)} />);
describe('PC-56 OPS-1b · /canon/biometric tells the whole truth of what is stored', () => {
  it('four stored-data sections in order: not stored anywhere · an AePS record · a day of attendance · pictures of faces', () => {
    expect(BIO_SECTIONS).toEqual(['notStored', 'aeps', 'attendance', 'photos']);
    expect((html.match(/data-kv-stored="([^"]+)"/g) ?? []).map((m) => m.slice(16, -1))).toEqual([...BIO_SECTIONS]);
  });
  it('the list includes face photos, and says erased ones are anonymised, not deleted (a lawyer decides)', () => {
    expect(text(html)).toContain('Pictures of faces are stored: a person\'s profile photo, and the selfie a person uploads for her own KYC, which is kept as a KYC document.');
    expect(en['ops1.bio.photos.erasure']).toMatch(/anonymised \(unlinked from the person\), not deleted\. A lawyer is to decide/);
    expect(text(html)).toContain(en['ops1.bio.photos.erasure']);
  });
  it('the AePS record is described AFTER Q7-A, and the GPS of attendance is named; no fingerprint and no face pattern is stored', () => {
    expect(text(html)).toContain(en['ops1.bio.aeps.not']);
    expect(en['ops1.bio.aeps.not']).toMatch(/no Aadhaar digit and is not linked to anyone's account/);
    expect(en['ops1.bio.attendance.body']).toMatch(/location at clock-in and its distance from the work site's fence/);
    expect(text(html)).toContain(en['ops1.bio.notStored.body']);
  });
  it('no "template … device", no "never the face", no access trail, no number to call; zero controls', () => {
    expect(/template[^.]*device|device[^.]*template/i.test(visible(html))).toBe(false);
    expect(FALSE_1B.test(visible(html))).toBe(false);
    expect(controls(html)).toEqual(NONE);
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('biometric_canon'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
  it.each([['hi', hi], ['gu', gu]] as const)('%s: every section prints in its own words', (_l, cat) => {
    const h = renderToStaticMarkup(<BiometricCanonView t={tr(cat)} />);
    for (const id of BIO_SECTIONS) expect([id, text(h).includes(cat[`ops1.bio.${id}.body`])]).toEqual([id, true]);
    expect(text(h)).toContain(cat['ops1.bio.photos.erasure']);
  });
});
