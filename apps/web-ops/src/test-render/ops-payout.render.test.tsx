// apps/web-ops/src/test-render/ops-payout.render.test.tsx · PC-56 OPS-1a · W367 /payout — A READ (founder 1a-1, Q2-A). The founder's statement
// verbatim; each bill's SERVER amounts through the money formatter; no computed total (no sum of any bills' figures appears); no "=" / "−";
// no percentage; the page-size select is the ONLY input-like control (no <input>, one <select>); no approve / pay; every state (ok / empty /
// no cycle / error → the Retry chain / off); "Send to tenant payout desk" refused by name; the drill-in and the bill's own read.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { PayoutView } from '../components/ops1/PayoutView';
import { PayoutBillView } from '../components/ops1/PayoutBillView';
import { en } from '../i18n/en';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { parsePageSize, parseCursor, payoutState, payoutHref } from '../features/ops1/payout';
import { BILLS_1A, CODES_1A, FALSE_1A, INPUTS, percents, text, tr, visible } from './ops1a-fixtures';

const T = tr(en);
const STATEMENT = 'Bills are approved and paid by your organisation\'s dairy desk, not from this console. Nothing is approved or paid here.';
const page = (state: Parameters<typeof PayoutView>[0]['state'], bills = BILLS_1A, nextCursor: string | null = null) =>
  renderToStaticMarkup(<PayoutView t={T} lang="en" state={state} bills={bills} memberCodes={CODES_1A} size={25} nextCursor={nextCursor} />);
const money = (m: string | bigint) => formatMoneyMinor(String(m), 'INR', 'en');

describe('PC-56 OPS-1a · /payout renders a read of the bills and nothing else', () => {
  it('the founder\'s statement is printed verbatim (en, key ops1.payout.statement) in every state but off', () => {
    expect(en['ops1.payout.statement']).toBe(STATEMENT);
    for (const s of ['ok', 'empty', 'no_cycle', 'error'] as const) expect([s, text(page(s)).includes(STATEMENT)]).toEqual([s, true]);
    expect(text(page('off')).includes(STATEMENT)).toBe(false);
  });
  it('each bill row prints the server\'s gross / deductions / net through the money formatter, the state verbatim, the member code (never an id)', () => {
    const html = page('ok');
    for (const b of BILLS_1A) {
      const row = html.slice(html.indexOf(`data-kv-bill="${b.id}"`)); const cells = row.slice(0, row.indexOf('</tr>'));
      expect(cells).toContain(money(b.grossMinor)); expect(cells).toContain(money(b.deductionsMinor)); expect(cells).toContain(money(b.netMinor));
      expect(cells).toContain(`data-kv-status="${b.status}"`); expect(cells).toContain(`href="/payout/${b.id}"`);
    }
    expect(text(html)).toContain('TC-01'); expect(text(html)).toContain('Member not on this list');
    expect(text(html)).not.toContain('m-0003');
  });
  it('NO computed total: no sum of any two or all three bills\' figures appears, and no "=", "−" or percentage in the visible text', () => {
    const html = page('ok'); const vis = visible(html);
    for (const f of ['grossMinor', 'deductionsMinor', 'netMinor'] as const) {
      const v = BILLS_1A.map((b) => BigInt(b[f]));
      for (const s of [v[0] + v[1], v[0] + v[2], v[1] + v[2], v[0] + v[1] + v[2]]) if (!v.includes(s)) expect([f, s.toString(), text(html).includes(money(s))]).toEqual([f, s.toString(), false]);
    }
    expect([/=/.test(vis), /−/.test(vis), percents(text(html))]).toEqual([false, false, 0]);
    expect(FALSE_1A.test(vis)).toBe(false);
  });
  it('the page-size select is the ONLY input: zero <input>, exactly one <select> (name=size, 25/50/100, GET), no <textarea>, no approve / pay', () => {
    for (const s of ['ok', 'empty', 'no_cycle', 'error'] as const) {
      const html = page(s);
      expect([s, (html.match(INPUTS) ?? []).length, (html.match(/<select/g) ?? []).length, (html.match(/<form/g) ?? []).length]).toEqual([s, 0, 1, 1]);
      expect(html).toMatch(/<form method="get" action="\/payout"/);
      expect(html).toMatch(/<select[^>]*name="size"/);
      expect([s, (html.match(/<button/g) ?? []).length, /Approve|Pay \(run\)|data-kv-act=/.test(html)]).toEqual([s, 1, false]);   // the one button is the GET form's Show
    }
  });
  it('states: empty, no cycle, error (Retry → the DECOR chain), off — each its own sentence; keyset next link without a page count', () => {
    expect(text(page('empty', []))).toContain('No bills to show yet');
    expect(text(page('no_cycle', []))).toContain('No payout cycle yet');
    const err = page('error', []);
    expect(err).toContain('data-kv-decor="retry"'); expect(err).toContain('href="/payout?act=confirm"');
    expect(text(page('off', []))).toContain('Dairy is switched off');
    expect(page('off', [])).not.toMatch(/<select|<form/);
    const paged = page('ok', BILLS_1A, 'Y3Vyc29y');
    expect(paged).toContain('href="/payout?cursor=Y3Vyc29y"'); expect(/page \d+ of \d+/i.test(text(paged))).toBe(false);
  });
  it('"Send to tenant payout desk" is refused BY NAME: a DECOR link to ?act=confirm labelled with what is true, and the refusal list', () => {
    const html = page('ok');
    expect(html).toContain('data-kv-decor="send"');
    expect(text(html)).toContain('Why nothing is sent from here');
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('payout'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
    expect(text(html)).not.toContain('Send to tenant payout desk');
  });
  it('the pure state + paging helpers: 404 → off; failure → error; zero bills + zero cycles → no_cycle; hostile size/cursor dropped', () => {
    expect([payoutState(404, 0, null), payoutState(500, 0, null), payoutState('failed', 0, null), payoutState('ok', 0, 0), payoutState('ok', 0, 2), payoutState('ok', 0, null), payoutState('ok', 3, 0)])
      .toEqual(['off', 'error', 'error', 'no_cycle', 'empty', 'empty', 'ok']);
    expect([parsePageSize('50'), parsePageSize('7'), parsePageSize(undefined), parsePageSize(['100'])]).toEqual([50, 25, 25, 100]);
    expect([parseCursor('"><script>'), parseCursor('abc=')]).toEqual([undefined, 'abc=']);
    expect([payoutHref(25), payoutHref(50, 'c1')]).toEqual(['/payout', '/payout?size=50&cursor=c1']);
  });
  it('the bill\'s own read (/payout/[id]): server amounts, lines only when returned, no form, no sum; not found / off say so', () => {
    const b = { ...BILLS_1A[0], deductions: [{ id: 'l1', type: 'feed_credit', amountMinor: '43210', sourceType: 'credit', sourceId: 's1', status: 'pending' as const }] };
    const html = renderToStaticMarkup(<PayoutBillView t={T} lang="en" bill={b} memberCode="TC-01" state="ok" />);
    for (const m of [b.grossMinor, b.deductionsMinor, b.netMinor]) expect(text(html)).toContain(money(m));
    expect(html).toContain('data-kv-line="l1"'); expect(html).not.toMatch(/<form|<input|<select|<button/);
    expect(text(html)).toContain(STATEMENT);
    expect(text(renderToStaticMarkup(<PayoutBillView t={T} lang="en" bill={BILLS_1A[1]} memberCode={null} state="ok" />))).toContain('No deduction lines were returned with this bill.');
    expect(text(renderToStaticMarkup(<PayoutBillView t={T} lang="en" bill={null} memberCode={null} state="not_found" />))).toContain('This bill cannot be read here.');
    expect(text(renderToStaticMarkup(<PayoutBillView t={T} lang="en" bill={null} memberCode={null} state="off" />))).toContain('not switched on');
  });
  it('no money arithmetic in the payout sources: no BigInt / Number / parseFloat over an amount, no + or - between minor strings', () => {
    for (const rel of ['components/ops1/PayoutView.tsx', 'components/ops1/PayoutBillView.tsx', 'app/payout/page.tsx', 'app/payout/[id]/page.tsx', 'features/ops1/payout.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect([rel, /BigInt\(|parseFloat\(|Number\([^)]*Minor|Minor\s*[-+*]|[-+*]\s*\w*\.?\w*Minor\b|\.reduce\(/.test(src)]).toEqual([rel, false]);
    }
  });
});
