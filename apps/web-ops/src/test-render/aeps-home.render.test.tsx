// apps/web-ops/src/test-render/aeps-home.render.test.tsx · PC-56 OPS-1b · W390 /aeps/home — HONEST, READS NOTHING (founder Q1-A). The founder's
// log sentence verbatim; zero controls; no figure (no digit); no cap, commission, "free" or NPCI line; the four real links; refusals by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AepsHomeView } from '../components/ops1/AepsViews';
import { en } from '../i18n/en';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_1B, NONE, controls } from './ops1b-fixtures';

const html = renderToStaticMarkup(<AepsHomeView t={tr(en)} />);
describe('PC-56 OPS-1b · /aeps/home is honest and reads nothing', () => {
  it('says the log is a log, verbatim: "Record what the bank\'s device showed. This platform did not move the money and cannot check it."', () => {
    expect(text(html)).toContain('Record what the bank\'s device showed. This platform did not move the money and cannot check it.');
    for (const k of ['ops1.aeps.home.kept', 'ops1.aeps.home.attempts', 'ops1.aeps.home.enabled']) expect([k, text(html).includes(en[k])]).toEqual([k, true]);
    expect(en['ops1.aeps.home.kept']).toMatch(/keeps no Aadhaar digit and is not linked to anyone's account/);
  });
  it('zero controls; no digit at all in the visible text; none of the canon\'s false words', () => {
    expect(controls(html)).toEqual(NONE);
    expect(/\d/.test(visible(html))).toBe(false);
    expect(FALSE_1B.test(visible(html))).toBe(false);
  });
  it('links to W391, W392, W393 and W399 (the inbound edges the canon never drew); every W390 refusal listed by name', () => {
    for (const h of ['/aeps/withdrawal', '/aeps/exceptions', '/aeps/receipt', '/canon/biometric']) expect([h, html.includes(`href="${h}"`)]).toEqual([h, true]);
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('aeps_home'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
});
