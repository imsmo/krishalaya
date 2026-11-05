// apps/web-partner/src/test-render/insurer-settlements.render.test.tsx · PC-56 PARTNER-6a · W260 (canon `insurer/settlements`) — CLAIM
// SETTLEMENTS, COUNTS ONLY (founder 6a-1). The load-bearing assertions: the founder's statement VERBATIM in every state but switched-off; the
// approved and partially-approved COUNTS with the "filed in this window" wording, each a real link to the claims queue filtered by that status;
// "Paid 0" beside "No claim is paid on this platform." VERBATIM; NO "₹" and no digit beside one, no money figure, no claimant, no account, no
// "run" (M1 kills here); "Release today's run" DECOR into the chain; "View claims" real; the empty, error and switched-off states.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import { InsurerSettlementsView } from '../components/partner6/InsurerSettlementsView';
import { partner6RefusalKeys } from '../features/partner6/refusals';
import { settlementsState, type SettlementsState } from '../features/partner6/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { COUNTS_6A, COUNTS_6A_EMPTY, COUNTS_6A_RANGE, FALSE_6A, FORM_CONTROL_6A } from './partner6a-fixtures';

const r = (state: SettlementsState = 'ok', counts: PartnerInsuranceClaimCounts | null = COUNTS_6A, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<InsurerSettlementsView t={tr(cat)} lang="en" state={state} counts={counts} />);
const STATEMENT = 'No claim is paid on this platform, and no money moves between your organisation and the platform. The counts below are the claims on your products that have been approved; the payment that would follow is not made here.';
const PAID_NONE = 'No claim is paid on this platform.';
const count = (html: string, id: string) => (new RegExp(`data-kv-count="${id}"><dt>[^<]*</dt><dd>(\\d+)</dd>`).exec(html) ?? [])[1];

describe('PC-56 PARTNER-6a · W260 claim settlements (render)', () => {
  it('THE FOUNDER\'S STATEMENT (6a-1) VERBATIM, and "No claim is paid on this platform." — in all three languages, ok and empty and error', () => {
    expect(en['partner6.settlements.statement']).toBe(STATEMENT);
    expect(en['partner6.settlements.paidNone']).toBe(PAID_NONE);
    for (const cat of [en, hi, gu]) {
      for (const [state, c] of [['ok', COUNTS_6A], ['empty', COUNTS_6A_EMPTY], ['error', null]] as const) {
        const html = r(state, c, cat);
        expect([state, html.includes('data-kv-statement="partner6.settlements.statement"')]).toEqual([state, true]);
        expect([state, text(html).includes(cat['partner6.settlements.statement'])]).toEqual([state, true]);
      }
      expect(text(r('ok', COUNTS_6A, cat))).toContain(cat['partner6.settlements.paidNone']);
    }
  });
  it('the COUNTS: approved and partially approved, filed in this window, each "awaiting a settlement this platform does not make"; their sum; Paid 0 — No claim is paid on this platform.', () => {
    const html = r(); const w = text(html);
    expect([count(html, 'approved'), count(html, 'partially_approved'), count(html, 'awaiting'), count(html, 'paid')]).toEqual(['5', '2', '7', '0']);
    expect(w).toContain(en['partner6.settlements.approved']); expect(w).toContain(en['partner6.settlements.partial']);
    expect(en['partner6.settlements.approved']).toMatch(/awaiting a settlement this platform does not make/);
    expect(w).toContain('Claims filed in financial year 2026-27 (April to March, India time)');
    expect(w).toContain(en['partner6.settlements.filedNote']);
    expect(w).toMatch(/Paid 0 No claim is paid on this platform\./);
    // the other statuses of the machine are not printed here (the queue has them); nothing is a ratio
    for (const s of ['intimated', 'rejected', 'closed', 'surveyed']) expect([s, html.includes(`data-kv-count="${s}"`)]).toEqual([s, false]);
    // an explicit window prints its two days
    expect(text(r('ok', COUNTS_6A_RANGE))).toContain('Claims filed from 2026-08-01 to 2026-11-01 (India time)');
  });
  it('each status count links to the claims queue FILTERED by that status (the queue\'s real `?status=`); paid links nowhere', () => {
    const html = r();
    const links = [...html.matchAll(/<a data-kv-claims-link="([^"]*)" href="([^"]*)"/g)].map(([, id, h]) => [id, h]);
    expect(links).toEqual([['approved', '/insurer/claims?status=approved'], ['partially_approved', '/insurer/claims?status=partially_approved']]);
    expect(html).not.toContain('?chip=');
    expect(html).not.toContain('status=paid');
  });
  it('NO MONEY: no "₹", no digit beside one, no money-shaped figure, no "%", no claimant, no account, no "run" — in any language or state (M1 kills here)', () => {
    for (const cat of [en, hi, gu]) for (const [state, c] of [['ok', COUNTS_6A], ['empty', COUNTS_6A_EMPTY], ['error', null]] as const) {
      const html = r(state, c, cat); const w = text(html); const visible = text(withoutRefusals(html));
      expect([state, w.includes('₹'), /₹\s*[\d०-९૦-૯]|[\d०-९૦-૯]\s*₹/.test(w)]).toEqual([state, false, false]);
      expect([state, MONEY.test(visible)]).toEqual([state, false]);
      expect([state, percents(w)]).toEqual([state, 0]);
      expect([state, FALSE_6A.test(visible)]).toEqual([state, false]);
      expect([state, /claimant|account|\bruns?\b/i.test(visible)]).toEqual([state, false]);
      expect([state, FORM_CONTROL_6A.test(html)]).toEqual([state, false]);
    }
    expect(r()).not.toContain('<table');
  });
  it('"Release today\'s run" is DECOR into the chain, worded with what is true; "View claims" is a REAL link; the page is the claims sub-navigation\'s Settlements row', () => {
    const html = r();
    expect(html).toMatch(/data-kv-decor="release" href="\/insurer\/settlements\?act=confirm"/);
    expect(text(html)).toContain(en['partner6.settlements.releaseAct']);
    expect(html).toMatch(/data-kv-real="claims" href="\/insurer\/claims"/);
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/insurer\/settlements"/);
    expect([...html.matchAll(/data-kv-subnav-item="/g)].length).toBe(7);
  });
  it('every W260 refusal is printed BY NAME — the reused 3a / 4 keys among them', () => {
    const html = r(); const w = text(html);
    const keys = partner6RefusalKeys('settlements');
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['approved_to_paid', 'release_run', 'paying_chip', 'ready_to_pay', 'paid_year', 'failed_transfers', 'disputes', 'claim_row', 'sums_verified',
      'payout_link', 'public_check', 'daily_job', 'reassembles', 'finance_role', 'plan_settings']) expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    for (const k of ['partner3.refusal.payoutBatch', 'partner3.refusal.payingChip', 'partner4.refusal.planSettings', 'partner4.refusal.platformRoles']) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('EMPTY (no approved claim in the window) still prints Paid 0 and the statement; ERROR prints Retry into the chain and no count; OFF reads as OFF', () => {
    const e = r('empty', COUNTS_6A_EMPTY);
    expect(e).toContain('data-kv-state="empty"'); expect(e).toContain('data-kv-empty="settlements"');
    expect([count(e, 'approved'), count(e, 'partially_approved'), count(e, 'paid')]).toEqual(['0', '0', '0']);
    expect(text(e)).toContain(PAID_NONE);
    expect(settlementsState(COUNTS_6A_EMPTY, null)).toBe('empty');
    expect(settlementsState(COUNTS_6A, null)).toBe('ok');
    expect([settlementsState(null, null), settlementsState(COUNTS_6A, 'off'), settlementsState(null, 'insurance_off')]).toEqual(['error', 'off', 'insurance_off']);
    const err = r('error', null);
    expect(err).toContain('role="alert"'); expect(err).toContain('data-kv-error="counts"');
    expect(err).toMatch(/data-kv-decor="retry" href="\/insurer\/settlements\?act=confirm"/);
    expect(err).not.toContain('data-kv-count=');
    expect(text(err)).not.toMatch(/unavailable/i);
    for (const which of ['off', 'insurance_off'] as const) {
      const off = r(which, null);
      expect(off).toContain(`data-kv-state="${which}"`);
      expect(off).not.toContain('data-kv-statement="partner6.settlements.statement"');
      expect(text(off)).not.toMatch(/plan settings/i);
    }
    expect(text(r('off', null))).toContain(en['partner.off.body']);
  });
  it('a paid count the server answered is printed as the server answered it — never invented, never hidden (0 by construction on this platform)', () => {
    expect(count(r('ok', { ...COUNTS_6A, byStatus: { ...COUNTS_6A.byStatus, paid: 3 } }), 'paid')).toBe('3');
  });
  it('the page: session gate, then the kind gate, then the chain state FIRST, then the ONE counts read — no other read, no money import', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'insurer', 'settlements', 'page.tsx'), 'utf8');
    const body = src.slice(src.indexOf('export default async function'));
    const at = (s: string) => body.indexOf(s);
    expect(at('await requirePartner()')).toBeGreaterThan(0);
    expect(at('await insurerGate()')).toBeGreaterThan(at('await requirePartner()'));
    expect(at("chain6State('settlement_act'")).toBeGreaterThan(at('await insurerGate()'));
    expect(at('partner.insurance.claims.counts()')).toBeGreaterThan(at("chain6State('settlement_act'"));
    expect((body.match(/partnerClient\(\)/g) ?? []).length).toBe(1);
    expect(/claims\.list|claims\.get|formatMoney|export const revalidate/.test(src)).toBe(false);
    expect(src).toContain("export const dynamic = 'force-dynamic'");
    expect(src).toContain('robots: { index: false, follow: false }');
  });
});
