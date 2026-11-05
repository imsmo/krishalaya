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
const NAV_1 = ['nav.payout', 'nav.withdrawal', 'nav.aeps', 'nav.aepsRecord', 'nav.aepsExceptions', 'nav.attendance', 'nav.biometric', 'dash.wave.aeps', 'dash.wave.attendance'];
const scoped = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('ops1.') || NAV_1.includes(k));

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

// ── PC-56 OPS-1b (brief §E6): the AePS / biometric guards. PLAIN guards match anywhere; AFFIRMATIVE guards match only a sentence that carries
// no negation (so "There is no receipt here: …" passes, while the canon's "The receipt carries the same numbers …" is caught). Each is proven on
// its own canon phrase, and each affirmative one is ALSO proven to let its negated form through (the narrowing is itself tested).
const NEGATION = /\b(not|no|never|nothing|none|cannot|nobody)\b|n't\b/i;
const sentences = (v: string) => v.split(/(?<=[.!?])\s+/);
const affirmative = (re: RegExp) => (v: string) => sentences(v).some((x) => re.test(x) && !NEGATION.test(x));
const plain = (re: RegExp) => (v: string) => re.test(v);
const GUARDS_1B: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated?: string]> = [
  ['%', plain(/%/), 'averaging 2.4% of float'],
  ['receipt/slip (affirmative)', affirmative(/\b(receipts?|slips?)\b/i), 'The receipt carries the same numbers the bank\'s own ledger holds.', 'There is no receipt here.'],
  ['bank\'s own ledger', plain(/bank['’]s own ledger/i), 'the same numbers the bank\'s own ledger holds'],
  ['10,000', plain(/\b10,000\b/), 'Per-transaction cap ₹10,000'],
  ['cap set by', plain(/cap set by/i), 'cap set by NPCI/bank, shown before you start.'],
  ['commission (affirmative)', affirmative(/commission/i), 'This service is FREE to you — the bank pays the kiosk a commission.', 'No commission is shown here.'],
  ['stealing', plain(/stealing/i), 'Anyone charging you for AePS is stealing.'],
  ['FREE to you', plain(/free to you/i), 'This service is FREE to you'],
  ['NPCI', plain(/NPCI/), 'travels encrypted from this device to your bank via NPCI/UIDAI'],
  ['UIDAI', plain(/UIDAI/), 'travels encrypted from this device to your bank via NPCI/UIDAI'],
  ['RD-certified (affirmative)', affirmative(/\bRD[- ]certified/i), 'This kiosk switches every AePS attempt to its backup RD-certified device automatically.', 'The reader is not RD-certified.'],
  ['micro-ATM authori', plain(/micro-ATM authori/i), 'holds the micro-ATM authorisation on her ambassador profile'],
  ['retries automatically / on its own', plain(/retr(y|ies|ied) (automatically|on its own)/i), 'the kiosk retries on its own schedule'],
  ['face template', plain(/face template/i), 'Your face template lives on THIS device, encrypted'],
  ['on this device', plain(/on (this|THIS) device/i), 'lives on THIS device, encrypted'],
  ['delete it any time', plain(/delete it any time/i), 'delete it any time at the sardar\'s tablet'],
  ['1800-', plain(/1800-/), 'or by calling 1800-419-0123'],
  ['*123#', plain(/\*123#/), 'મદદ 1800-419-0123 · *123#'],
  ['never the face', plain(/never the (fingerprint or the )?face/i), 'never the fingerprint or the face itself.'],
  ['access trail', plain(/access trail/i), 'lands in the access trail (W356 pattern)'],
  ['plan settings', plain(/plan settings/i), 'Nothing is broken — it is not enabled. See plan settings.'],
];
const BRAND_1B: ReadonlyArray<[RegExp, string]> = [
  [/Kiran/i, 'Kiran Ben V.'], [/Jashoda/i, 'Jashoda Ben R.'], [/Raju/i, 'Raju Bhai'], [/Bank of Baroda/i, 'Bank of Baroda a/c XXXXXX••27'], [/Kisan Mitra/i, 'Kisan Mitra Kiosk'],
  [/Krishalaya Kiosk/i, 'Krishalaya Kiosk'], [/XXXX/, 'Aadhaar XXXX-XXXX-••41'], [/NPCI-AEPS/, 'NPCI-AEPS-26-71••88'], [/96•••/, '+91 96••• ••883'], [/Bhesan/i, 'Bhesan orchard'],
];
const SOURCES_1B = ['components/ops1/AepsViews.tsx', 'components/ops1/FaceViews.tsx', 'app/aeps/home/page.tsx', 'app/aeps/withdrawal/page.tsx', 'app/aeps/withdrawal/actions.ts',
  'app/aeps/exceptions/page.tsx', 'app/aeps/receipt/page.tsx', 'app/attendance/face-enroll/page.tsx', 'app/attendance/face-attendance/page.tsx', 'app/canon/biometric/page.tsx', 'features/ops1/aeps.ts'];

describe('PC-56 OPS-1b · the claims guard (ops1. scope, AePS and biometrics)', () => {
  it('each guard is proven on its own canon phrase; each affirmative guard lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_1B) {
      expect([name, hit(canon)]).toEqual([name, true]);
      if (negated) expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_1B) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no ops1. value (or 1b nav label) trips a 1b guard or brand regex', (_lang, cat) => {
    for (const [k, v] of scoped(cat)) {
      for (const [name, hit] of GUARDS_1B) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_1B) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the founder\'s AePS sentence is PINNED verbatim, and the receipt page says the bank\'s device prints the bank\'s slip', () => {
    expect(en['ops1.aeps.statement']).toBe('Record what the bank\'s device showed. This platform did not move the money and cannot check it.');
    expect(en['ops1.aeps.receipt.statement']).toBe('There is no receipt here: the bank\'s device prints the bank\'s slip, and this console keeps the operator\'s record.');
    expect(en['ops1.chain.aepsAct.confirm.title']).toBe('Record what the bank\'s device showed (nothing moves here)');
    expect(en['ops1.chain.aepsAct.success.title']).toBe('Recorded: a record, not a receipt');
    expect(en['ops1.chain.aepsAct.failure.title']).toBe('Nothing was recorded');
    expect(en['ops1.face.statement']).toMatch(/^No face is captured on this platform\. Attendance is recorded by the worker's own clock-in, by a signed sheet the desk records, or by a reviewer's vouch\.$/);
  });
  it('brand guard over every new ops1 source (pages, actions, views, helpers)', () => {
    for (const rel of SOURCES_1B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of [...BRAND_1A.filter(([r]) => !String(r).includes('₹')), ...BRAND_1B]) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

describe('PC-56 OPS-1a · the claims guard (ops1. scope)', () => {
  it('each guard is proven on its own canon phrase', () => {
    for (const [re, phrase] of [...GUARDS_1A, ...BRAND_1A]) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no ops1. value matches any guard or brand regex', (_lang, cat) => {
    for (const [k, v] of scoped(cat)) for (const [re] of [...GUARDS_1A, ...BRAND_1A]) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
  });
  it('the founder\'s statements are PINNED verbatim', () => {
    // NAMED UPDATE (PC-56 OPS-1b, founder 2026-11-06 — the restore): OPS-1a pinned the ABSENCE of "with two people" because paying a milk bill was
    // one person. HOTFIX-11 (`8529d5d4`) made it true — on every bill the previewer cannot approve and the approver cannot pay
    // (`milk-bill.entity.ts` approve / assertPayer, DB-enforced by 0233) — so the founder's ORIGINAL sentence is restored and pinned verbatim, and
    // every language must say "two people" in its own words.
    expect(en['ops1.payout.statement']).toBe('Bills are approved and paid by your organisation\'s dairy desk, with two people, not from this console. Nothing is approved or paid here.');
    expect([/with two people/.test(en['ops1.payout.statement']), /दो लोग/.test(hi['ops1.payout.statement']), /બે વ્યક્તિ/.test(gu['ops1.payout.statement'])]).toEqual([true, true, true]);
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
