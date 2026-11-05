// apps/web-ops/src/test-render/face-attendance.render.test.tsx · PC-56 OPS-1b · W398 /attendance/face-attendance — HONEST (the summary read gives
// tenant-wide review tiles, not a booking's counts by method — attendance.repository.ts:151-167): no count, no sum, no wage figure, no face.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FaceAttendanceView } from '../components/ops1/FaceViews';
import { en } from '../i18n/en';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_1B, NONE, controls } from './ops1b-fixtures';

const html = renderToStaticMarkup(<FaceAttendanceView t={tr(en)} />);
describe('PC-56 OPS-1b · /attendance/face-attendance prints no number', () => {
  it('no digit, no ₹, no ×/+/= in the visible text; zero controls; it says why there is no count and no wage', () => {
    expect(/\d|₹|×|\+|=/.test(visible(html))).toBe(false);
    expect(controls(html)).toEqual(NONE);
    expect(text(html)).toContain(en['ops1.face.attendance.noCounts']); expect(text(html)).toContain(en['ops1.face.attendance.noWage']);
    expect(FALSE_1B.test(visible(html))).toBe(false);
    expect(/\bOTP\b|lantern|regardless/i.test(visible(html))).toBe(false);
  });
  it('the page makes no read (the verdict is HONEST, not a read of the summary), and lists the W398 refusals by name', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/attendance/face-attendance/page.tsx'), 'utf8');
    expect(/opsClient|attendance\/summary\(|\.labour\./.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))).toBe(false);
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('face_attendance'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
    expect(html).toContain('href="/attendance/face-enroll"'); expect(html).toContain('href="/canon/biometric"');
  });
});
