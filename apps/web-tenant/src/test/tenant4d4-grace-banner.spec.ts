// PC-56 TENANT-4d-4 · W120's footnote, once it is true — the grace banner's rules.
//
// MUTATION SURVIVORS (round 1) drove this file: the new grace functions had no web tests at all, so a banner
// that rendered for a tenant NOT in a window, a last day that read as expired, and a notification gap that
// collapsed into "there is no grace period" (shown to a tenant who is IN one) all passed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GraceView, gapReasonKey, graceAdviceKey, graceBannerKey, graceIsWarningNotError } from '../features/billing/invoices';

const g = (over: Partial<GraceView> = {}): GraceView => ({ inGrace: true, graceUntil: '2026-07-27', daysLeft: 4, advice: 'pay_open_invoice', ...over });

describe('TENANT-4d-4 · the grace banner', () => {
  it('renders ONLY for a tenant actually inside the window', () => {
    expect(graceBannerKey(g())).toBe('bill.grace.open');
    expect(graceBannerKey(g({ inGrace: false }))).toBeNull();
    // A banner for a tenant who is not in a window would announce a billing problem they do not have.
    expect(graceBannerKey(g({ inGrace: false, daysLeft: 0 }))).toBeNull();
    expect(graceAdviceKey(g({ inGrace: false }))).toBeNull();
  });

  it('THE LAST DAY HAS ITS OWN SENTENCE — "0 days left" reads as already over', () => {
    expect(graceBannerKey(g({ daysLeft: 0 }))).toBe('bill.grace.lastDay');
    expect(graceBannerKey(g({ daysLeft: 1 }))).toBe('bill.grace.open');
    expect(graceBannerKey(g({ daysLeft: 0 }))).not.toBe(graceBannerKey(g({ daysLeft: 1 })));
  });

  it('the advice is to PAY, or to contact us — never to wait for a retry we do not perform', () => {
    expect(graceAdviceKey(g({ advice: 'pay_open_invoice' }))).toBe('bill.grace.payNow');
    expect(graceAdviceKey(g({ advice: 'contact_platform' }))).toBe('bill.grace.contact');
    expect(graceAdviceKey(g({ advice: 'pay_open_invoice' }))).not.toBe(graceAdviceKey(g({ advice: 'contact_platform' })));
  });

  it('and it is a NOTICE, not an error: nothing has been switched off yet', () => {
    expect(graceIsWarningNotError(g())).toBe(true);
    expect(graceIsWarningNotError(g({ inGrace: false }))).toBe(false);
  });
});

describe('TENANT-4d-4 · the notification gap is its OWN gap', () => {
  it('and does not collapse into "there is no grace period" — which would be said to a tenant inside one', () => {
    expect(gapReasonKey('no_notification')).toBe('bill.gap.noNotification');
    expect(gapReasonKey('no_grace_state')).toBe('bill.gap.noGrace');
    expect(gapReasonKey('no_notification')).not.toBe(gapReasonKey('no_grace_state'));
    expect(gapReasonKey('no_saas_mandate')).toBe('bill.gap.noMandate');
    expect(gapReasonKey('not_scheduled')).toBe('bill.gap.notScheduled');
    expect(gapReasonKey('exists')).toBeNull();
  });
});

describe('TENANT-4d-4 · W120 renders the footnote from the tenant\'s own state', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('the banner is on the billing page, styled as a notice, with the advice beneath it', () => {
    const s = read('app', 'billing', 'page.tsx');
    expect(s).toContain('graceBannerKey(view.grace)');
    expect(s).toContain('graceAdviceKey(view.grace)');
    expect(s).toContain('kv-card--notice');
    expect(s).toContain('role="status"');   // not role="alert": nothing is switched off
  });

  it('every new key is translated in all three launch languages, with no blanks', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('bill.grace.') || k === 'bill.gap.noNotification');
    expect(mine.length).toBeGreaterThanOrEqual(5);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
    for (const f of ['en.ts', 'hi.ts', 'gu.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'i18n', f), 'utf8');
      for (const m of src.matchAll(/^\s{2}'(bill\.grace\.[^']+)':\s*'([^']*)'/gm)) expect(m[2].length).toBeGreaterThan(0);
    }
  });
});
