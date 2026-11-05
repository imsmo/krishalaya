// apps/web-ops/src/test-render/ops-withdrawal.render.test.tsx · PC-56 OPS-1a · W377 /warehouse/withdrawal — AN HONEST PAGE THAT READS NOTHING
// (founder 1a-2, Q3-A). The honest sentences verbatim; no input of any kind; no figure (no digit at all in the visible text); no part-release
// arithmetic; "Request release" refused by name; the page and its view import no API client. Also the booking page's paused-release sentence.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WithdrawalView, ReleasePaused } from '../components/ops1/WithdrawalView';
import { en } from '../i18n/en';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { CONTROLS, FALSE_1A, percents, text, tr, visible } from './ops1a-fixtures';

const T = tr(en);
const html = renderToStaticMarkup(<WithdrawalView t={T} />);

describe('PC-56 OPS-1a · /warehouse/withdrawal is honest and reads nothing', () => {
  it('prints how release works here, verbatim: the whole booking, the operator\'s act, the fee from her wallet at release — and that it is paused', () => {
    for (const k of ['ops1.withdrawal.statement', 'ops1.withdrawal.noPartial', 'ops1.withdrawal.noPledge']) expect([k, text(html).includes(en[k])]).toEqual([k, true]);
    expect(en['ops1.withdrawal.statement']).toMatch(/whole booking.*warehouse operator.*depositor's wallet.*moment of release.*paused until the depositor can confirm/);
    expect(en['ops1.withdrawal.noPledge']).toBe('No receipt is pledged on this platform yet.');
  });
  it('no input, no select, no form, no button; no figure at all (no digit), no percentage, no part-release arithmetic', () => {
    expect(CONTROLS.test(html)).toBe(false);
    expect(/\d/.test(visible(html))).toBe(false);
    expect(percents(text(html))).toBe(0);
    expect(/qtl|−|=|\bpartial\b/i.test(visible(html))).toBe(false);
    expect(FALSE_1A.test(visible(html))).toBe(false);
  });
  it('"Request release" is refused BY NAME (a DECOR link to ?act=confirm, labelled not available) and every W377 refusal is listed; a real link to the bookings', () => {
    expect(html).toContain('href="/warehouse/withdrawal?act=confirm"'); expect(text(html)).toContain('Request release: not available');
    expect(html).toContain('href="/warehouse"');
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('withdrawal'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
  it('the page and its view read nothing: no opsClient, no SDK call, no fetch', () => {
    for (const rel of ['app/warehouse/withdrawal/page.tsx', 'components/ops1/WithdrawalView.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /opsClient|api-client|fetch\(|\.warehousing\./.test(src)]).toEqual([rel, false]);
    }
    // positive control: the payout page DOES read (so the assertion above can see a read when there is one)
    expect(/opsClient\(/.test(fs.readFileSync(path.join(__dirname, '..', 'app/payout/page.tsx'), 'utf8'))).toBe(true);
  });
  it('the booking page prints the paused-release sentence where its release button was — no button — and links here', () => {
    const p = renderToStaticMarkup(<ReleasePaused t={T} />);
    expect(text(p)).toContain(en['ops1.withdrawal.paused']); expect(p).toContain('href="/warehouse/withdrawal"'); expect(CONTROLS.test(p)).toBe(false);
    const src = fs.readFileSync(path.join(__dirname, '..', 'app/warehouse/[id]/page.tsx'), 'utf8');
    expect(/kind: 'release'|wh\.actRelease/.test(src)).toBe(false);
    expect(src).toContain('<ReleasePaused t={t} />');
  });
});
