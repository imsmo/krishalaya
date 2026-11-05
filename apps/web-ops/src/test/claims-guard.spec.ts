// apps/web-ops/src/test/claims-guard.spec.ts · PC-56 OPS-1 — the CLAIMS GUARD for the field desk (the web-partner shape), `ops1.` scope.
// Each regex is first PROVEN on the canon phrase it exists to stop (so a regex that matches nothing cannot pass silently), then asserted
// against every `ops1.` value (and the two new nav labels) in en, hi and gu. The refusals are worded so the canon's words never appear even in
// the negative — the guard is a plain affirmative-shape match. The founder's statements are PINNED verbatim. Plus a BRAND guard: no canon
// person, member number, bill / receipt / booking reference or place in any `ops1.` value or in an ops1 page or component source.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const scoped = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('ops1.') || k === 'nav.payout' || k === 'nav.withdrawal');

/** [regex, the canon phrase it is proven on] */
const GUARDS_1A: ReadonlyArray<[RegExp, string]> = [
  [/%/, 'Deductions above 25% of gross'],
  [/zero-sum/i, 'Money-adjacent actions reconcile zero-sum before this page ever shows.'],
  [/reconcil/i, 'Money-adjacent actions reconcile zero-sum before this page ever shows.'],
  [/wage[- ]lane/i, 'payouts ride the WAGE LANE (W066 canon: milk money never queues behind commerce)'],
  [/page \d+ of \d+/i, 'Showing 3 of 214 bills · Page size · Page 1 of 9'],
  [/went to every member/i, 'Preview SMS went to every member Sat 11'],
  [/across organisations/i, 'MCC prepares; the tenant dairy desk approves and pays (maker-checker across organisations)'],
  [/forever/i, 'Both names on the run forever.'],
  [/pays nobody/i, "a payout run with holes pays nobody until it's whole (all-or-explain)"],
  [/partial release/i, 'Partial release preview 62.60 qtl − 20.00 qtl = 42.60 qtl'],
  [/\bNOC\b/, 'Rule: pledged receipts need lender NOC'],
  [/0\.5 ?%/, 'Weighbridge OUT ties the loop … within 0.5% before this withdrawal is confirmed'],
  [/depositor-only/i, 'Withdrawal request is depositor-only'],
  [/receipt balance/i, 'The receipt balance is unchanged — nothing was released without confirmation.'],
  [/plan settings/i, 'Nothing is broken — it is not enabled. See plan settings.'],
  [/send to tenant payout desk/i, 'Send to tenant payout desk'],
  [/on-call/i, 'repeated failures page the on-call.'],
  [/[=−×]/, 'Net to farmers ₹10,79,170.20 = gross − deductions, to the paisa'],
];
const BRAND_1A: ReadonlyArray<[RegExp, string]> = [
  [/Vanthali/i, 'Vanthali MCC'], [/Anand FPO/i, 'Anand FPO · dairy ops'], [/Gondal/i, 'Gondal Agri Warehouse'], [/Meera/i, 'Meera Ben D. · #0781'],
  [/Ramesh|Patel/i, 'Ramesh Patel'], [/Kanti/i, 'Kanti Bhai P. · #0233'], [/MB-\d{4}/, 'MB-0781-0701'], [/#0\d{3}\b/, '#0781'], [/NERL-\d{2}-/, 'NERL-26-GJ-88214'],
  [/SB-20\d{2}-/, 'SB-2026-0871'], [/GJ-0412/, 'WDRA reg ••GJ-0412'], [/\b214\b/, '214 member pourers'], [/₹\s?[\d,]+/, '₹11,63,480.20'],
];

describe('PC-56 OPS-1a · the claims guard (ops1. scope)', () => {
  it('each guard is proven on its own canon phrase', () => {
    for (const [re, phrase] of [...GUARDS_1A, ...BRAND_1A]) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no ops1. value matches any guard or brand regex', (_lang, cat) => {
    for (const [k, v] of scoped(cat)) for (const [re] of [...GUARDS_1A, ...BRAND_1A]) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
  });
  it('the founder\'s statements are PINNED verbatim', () => {
    expect(en['ops1.payout.statement']).toBe('Bills are approved and paid by your organisation\'s dairy desk, not from this console. Nothing is approved or paid here.');
    // NAMED UPDATE (OPS-1a lead, founder 2026-11-06): paying a milk bill is ONE person today, so the statement may not claim two people until the
    // second-person money hotfix lands — in any language.
    expect(/two people/i.test(en['ops1.payout.statement'])).toBe(false);
    expect(en['ops1.withdrawal.statement']).toBe('A release is the whole booking, made by the warehouse operator. The storage fee is taken from the depositor\'s wallet at the moment of release. Release is paused until the depositor can confirm the release and its fee herself, in her own sign-in.');
    expect(en['ops1.withdrawal.noPledge']).toBe('No receipt is pledged on this platform yet.');
    expect(en['ops1.withdrawal.paused']).toBe('Release is paused: the storage fee would leave the depositor\'s wallet without her confirming it. Nothing can be released from this console until she can confirm it herself.');
  });
  it('brand guard over the ops1 sources: no canon person, place, member number or reference in a page or component', () => {
    for (const rel of ['components/ops1/PayoutView.tsx', 'components/ops1/PayoutBillView.tsx', 'components/ops1/WithdrawalView.tsx', 'components/ops1/Ops1Chain.tsx',
      'app/payout/page.tsx', 'app/payout/[id]/page.tsx', 'app/warehouse/withdrawal/page.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_1A.filter(([r]) => !String(r).includes('₹'))) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});
