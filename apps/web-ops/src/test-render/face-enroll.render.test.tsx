// apps/web-ops/src/test-render/face-enroll.render.test.tsx · PC-56 OPS-1b · W397 /attendance/face-enroll — NO FACE CAPTURE (founder Q5-A):
// honest, reads nothing. The statement ×3 (en verbatim; hi/gu present); zero controls; the three real ways attendance is recorded; no template,
// device store, toll-free number or consent script; links to W398 and W399.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FaceEnrollView } from '../components/ops1/FaceViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_1B, NONE, controls } from './ops1b-fixtures';

describe('PC-56 OPS-1b · /attendance/face-enroll: there is nothing to enrol', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the statement and the three methods print; zero controls; no digit', (_l, cat) => {
    const html = renderToStaticMarkup(<FaceEnrollView t={tr(cat)} />);
    for (const k of ['ops1.face.statement', 'ops1.face.enroll.lead', 'ops1.face.method.self', 'ops1.face.method.sheet', 'ops1.face.method.vouch', 'ops1.face.confirmPays']) expect([k, text(html).includes(cat[k])]).toEqual([k, true]);
    expect(controls(html)).toEqual(NONE);
    expect(/\d/.test(visible(html))).toBe(false);
  });
  it('en: the statement verbatim; no template / device / number / consent words; links to W398 and W399; the W397 refusals by name', () => {
    const html = renderToStaticMarkup(<FaceEnrollView t={tr(en)} />);
    expect(text(html)).toContain('No face is captured on this platform. Attendance is recorded by the worker\'s own clock-in, by a signed sheet the desk records, or by a reviewer\'s vouch.');
    expect(FALSE_1B.test(visible(html))).toBe(false);
    expect(/template|encrypted|consent|OTP|tablet/i.test(visible(html))).toBe(false);
    for (const h of ['/attendance/face-attendance', '/canon/biometric']) expect([h, html.includes(`href="${h}"`)]).toEqual([h, true]);
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('face_enroll'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
});
