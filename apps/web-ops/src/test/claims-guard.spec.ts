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
// NAMED UPDATE (PC-56 OPS-1c): the kiosk's nav labels and its dashboard row join the scope (a widening — every guard now also covers them).
const NAV_1 = ['nav.payout', 'nav.withdrawal', 'nav.aeps', 'nav.aepsRecord', 'nav.aepsExceptions', 'nav.attendance', 'nav.biometric', 'dash.wave.aeps', 'dash.wave.attendance',
  'nav.kiosk', 'nav.kioskStart', 'nav.kioskEarnings', 'dash.wave.kiosk'];
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

// ── PC-56 OPS-1c (brief §E6): the kiosk guards. Q10-A: no "session" claim in any `ops1.` value (route names such as /kiosk/session-start are
// canon addresses, never printed as words). Each is proven on its own canon phrase; the affirmative ones also let their negated form through.
const GUARDS_1C: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated?: string]> = [
  ['per-session', plain(/per-session/i), 'Assisted access is consent, per-session, and it expires the moment this session ends.'],
  ['session opens/ends/expires', plain(/session (opens|ends|expires|closed|closes)/i), 'The session opens only once the farmer confirms it.'],
  ['session (any, Q10-A)', plain(/\bsessions?\b/i), 'Assisted session — ambassador Kiran Ben V. (senior tier)'],
  ['access ended', plain(/access ended/i), "Kiran Ben's access ended when this session closed."],
  ['her own OTP (affirmative)', affirmative(/\bher own OTP\b/i), 'If it matches a member, she confirms with her own OTP before anything opens.', 'Nothing here asks for her own OTP.'],
  ['OTP (any, on a desk page)', plain(/\bOTP\b/), 'an OTP to her phone is how she grants it'],
  ['voice-note consent', plain(/voice[- ]note consent/i), "a family member's phone plus a recorded voice-note consent stands in for the OTP"],
  ['penny-drop', plain(/penny[- ]drop/i), 'Penny-drop · ₹1 sent with a narration code'],
  ['₹1 stays', plain(/₹\s?1 stays/i), 'The ₹1 stays yours.'],
  ['reversible right now', plain(/reversible right now/i), 'Anything from today is reversible right now'],
  ['pass-rate', plain(/pass[- ]rate/i), 'Verification pass-rate 97.6%'],
  ['Fri', plain(/\bFri\b/), 'weekly payout batch runs Fri (wage-lane)'],
  ['wage-lane', plain(/wage[- ]lane/i), 'weekly payout batch runs Fri (wage-lane)'],
  ['out-of-cluster', plain(/out-of-cluster/i), 'tagged out-of-cluster; no commission accrues'],
  ['battery', plain(/battery/i), 'Device battery — Below 20%'],
  ['synced', plain(/\bsynced\b/i), '✓ all sessions synced'],
  ['on this device', plain(/on (this|THIS) device/i), 'Anything already captured stays saved on this device'],
  ['1800-', plain(/1800-/), 'Change anything anytime: app, *123#, or 1800-419-0123.'],
  ['*123#', plain(/\*123#/), 'Change anything anytime: app, *123#, or 1800-419-0123.'],
  ['%', plain(/%/), 'Verification pass-rate 97.6%'],
  ['plan settings', plain(/plan settings/i), 'Nothing is broken — it is not enabled. See plan settings.'],
  ['₹60', plain(/₹\s?60\b/), 'Your onboarding pays Kiran Ben ₹60 from the FPO — you pay nothing.'],
  ['member created (affirmative)', affirmative(/\bmember(ship)? (is |was )?created\b/i), 'What we did today: Member created ✓', 'No membership is created here.'],
  ['flips', plain(/\bflips\b/i), 'kiosk_enabled flips true only after training_completed_at is recorded'],
  ['canon event codes', plain(/onboarding\.verified|scheme\.application\.submitted|first\.listing\.published/), 'onboarding.verified 42 × ₹60 = ₹2,520'],
];
const BRAND_1C: ReadonlyArray<[RegExp, string]> = [
  [/Kiran Ben/i, 'Kiran Ben V.'], [/Jashoda/i, 'Jashoda Ben R.'], [/Vanthali/i, 'Today: Vanthali'], [/Anand FPO/i, 'Anand FPO · Kisan Mitra Kiosk'], [/Kisan Mitra/i, 'Kisan Mitra Kiosk'],
  [/Krishalaya Kiosk/i, 'Krishalaya Kiosk'], [/GMISS/i, 'GMISS-2026 v2 rules'], [/GM26-/, 'GM26-1088••'], [/SR-JND/, 'SR-JND-88••4'], [/95•••|96•••/, '+91 95••• ••217'],
  [/XXXXXX/, 'XXXXXX••27'], [/GG-20/, 'GG-20 groundnut'],
];
const SOURCES_1C = ['components/ops1/KioskViews.tsx', 'features/ops1/kiosk.ts', 'features/kiosk/form.ts', 'app/kiosk/home/page.tsx', 'app/kiosk/session-start/page.tsx',
  'app/kiosk/session-start/actions.ts', 'app/kiosk/profile/page.tsx', 'app/kiosk/land-crops/page.tsx', 'app/kiosk/kyc/page.tsx', 'app/kiosk/bank/page.tsx',
  'app/kiosk/first-listing/page.tsx', 'app/kiosk/schemes/page.tsx', 'app/kiosk/summary/page.tsx', 'app/kiosk/ambassador/page.tsx'];

// ── PC-56 OPS-2c (brief §E6): the money-of-storage guards over the `ops2.` scope (and the two new nav labels). Each is proven on its own canon
// phrase and NARROWED TO THE AFFIRMATIVE (a sentence that carries a negation passes — "There is no rate card with versions" — while the canon's
// "Billed monthly in arrears at the versioned tariff on file" is caught); each affirmative guard is ALSO proven to let its negated form through.
// Plus plain guards for the chain and arithmetic words, the founder's sentences PINNED in every language, and a brand guard over the 2c sources.
const NAV_2 = ['nav.whBilling', 'nav.whInsights'];
const scoped2 = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('ops2.') || NAV_2.includes(k));
const GUARDS_2C: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated?: string]> = [
  ['% (affirmative)', affirmative(/%/), 'Occupancy 3,812 MT of 5,000 MT — 76.2% occupied.', 'No percentage is shown, not even 0%.'],
  ['billed monthly (affirmative)', affirmative(/billed monthly/i), 'Billed monthly in arrears at the versioned tariff on file.', 'Nothing is billed monthly.'],
  ['in arrears (affirmative)', affirmative(/in arrears/i), 'Billed monthly in arrears at the versioned tariff on file.', 'No fee is charged in arrears.'],
  ['versioned (affirmative)', affirmative(/versioned/i), 'Tariff ₹9/qtl/mo · versioned rate card', 'There is no versioned rate card.'],
  ['promo (affirmative)', affirmative(/promo/i), 'Free-storage promo first 14 days · tenant policy flag · currently ON', 'No promotion switch exists.'],
  ['free storage (affirmative)', affirmative(/free[- ]storage/i), 'Free-storage promo first 14 days', 'No free storage is offered.'],
  ['first 14 days (affirmative)', affirmative(/first 14 days/i), 'First 14 days are free under the current tenant promo (feature flag)', 'The first 14 days are not free.'],
  ['revenue (affirmative)', affirmative(/revenue/i), 'Month-to-date revenue ₹1,84,230.00 across 341 receipts + non-NWR lots', 'No revenue is shown.'],
  ['occupan (affirmative)', affirmative(/occupan/i), 'Occupancy 3,812 MT of 5,000 MT — 76.2% occupied.', 'No occupancy is shown.'],
  ['pledge rate (affirmative)', affirmative(/pledge rate/i), 'e-NWR pledge rate 41% of receipts', 'No pledge rate exists.'],
  ['turnaround (affirmative)', affirmative(/turnaround/i), 'Assay median turnaround 3.1h', 'No turnaround is measured.'],
  ['audit-stamped (affirmative)', affirmative(/audit-stamped/i), 'Export (audit-stamped)', 'Nothing here is audit-stamped.'],
  // The canon's promise is itself worded with "nothing", so the affirmative narrowing would let it through: this one is PLAIN on the promise's own
  // words (a refusal never says them); its negated sibling ("No fee is charged at all") passes.
  ['nothing is charged twice (the promise, plain)', plain(/nothing is charged twice/i), 'Last successfully billed cycle stands; nothing is charged twice and nothing is silently skipped.', 'No fee is charged at all here.'],
  ['zero-sum', plain(/zero-sum/i), 'Money-adjacent actions reconcile zero-sum before this page ever shows.'],
  ['reconcil', plain(/reconcil/i), 'Money-adjacent actions reconcile zero-sum before this page ever shows.'],
  ['on-call', plain(/on-call/i), 'repeated failures page the on-call.'],
  ['plan settings', plain(/plan settings/i), 'Nothing is broken — it is not enabled. See plan settings.'],
  ['× or = (any)', plain(/[×=]/), '62.60 qtl stored quantity × ₹9 rate/qtl/month = ₹563.40'],
  ['a rupee figure (any)', plain(/₹\s?\d/), 'Tariff ₹9/qtl/mo'],
];
const BRAND_2C: ReadonlyArray<[RegExp, string]> = [
  [/Gondal/i, 'Gondal Agri Warehouse'], [/Anand FPO/i, 'Anand FPO · warehouse ops'], [/Ramesh|Patel/i, 'Ramesh Patel — SB-2026-0871'], [/Paresh/i, 'the centre manager\'s (Paresh V.)'],
  [/AgriQual/i, 'AgriQual Labs'], [/Krishalaya Ops/i, 'Krishalaya Ops Console'], [/GJ-0412/, 'WDRA reg ••GJ-0412'], [/SB-20\d{2}-/, 'SB-2026-0871'], [/NERL-\d{2}-/, 'NERL-26-GJ-88214'],
  [/Bhavesh|Kanti|Meera|Ishwar/i, 'Bhavesh D.'], [/\b563\.40\b|1,84,230|3,812|76\.2/, '₹563.40'],
];
const SOURCES_2C = ['components/ops2/BillingView.tsx', 'components/ops2/InsightsView.tsx', 'components/ops2/Ops2Chain.tsx', 'app/warehouse/billing/page.tsx',
  'app/warehouse/insights/page.tsx', 'features/ops2/billing.ts', 'components/Sidebar.tsx'];

describe('PC-56 OPS-2c · the claims guard (ops2. scope, the money of storage)', () => {
  it('each guard is proven on its own canon phrase; each affirmative guard lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_2C) {
      expect([name, hit(canon)]).toEqual([name, true]);
      if (negated) expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_2C) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no ops2. value (or 2c nav label) trips a 2c guard or brand regex', (_lang, cat) => {
    // NAMED UPDATE (PC-56 OPS-2b): the 2b `ops2.` keys join this scope (a WIDENING — every 2c guard now also covers them): 76 → 243.
    // NAMED UPDATE (PC-56 OPS-2a): the 2a `ops2.` keys join it too (a WIDENING again): 243 → 364.
    expect(scoped2(cat).length).toBe(364);
    for (const [k, v] of scoped2(cat)) {
      for (const [name, hit] of GUARDS_2C) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_2C) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the founder\'s Q1-A sentence is PINNED verbatim in English, and "own wallet" is said in EVERY language (who would receive the fee today)', () => {
    expect(en['ops2.billing.payee']).toBe('Today, if release were switched on, the fee would be paid from the depositor\'s wallet into the warehouse operator\'s own wallet. Release is paused: it has been decided that the fee will go to your organisation\'s account, and release does not come back until that is built and the depositor can confirm it herself.');
    expect([/operator's own wallet/.test(en['ops2.billing.payee']), /संचालक के अपने ही वॉलेट/.test(hi['ops2.billing.payee']), /સંચાલકના પોતાના જ વૉલેટ/.test(gu['ops2.billing.payee'])]).toEqual([true, true, true]);
    // release is paused, in every language
    // PC-56 OPS-2c · founder 2026-11-06 (payee wording): no tenant organisation decided this on the platform — the drafted
    // "your organisation has decided" is refused in every language.
    expect([/organisation has decided/.test(en['ops2.billing.payee']), /संस्था ने तय किया/.test(hi['ops2.billing.payee']), /સંસ્થાએ નક્કી કર્યું/.test(gu['ops2.billing.payee'])]).toEqual([false, false, false]);
    expect([/Release is paused/.test(en['ops2.billing.payee']), /रिलीज़ रुकी है/.test(hi['ops2.billing.payee']), /રિલીઝ અટકેલી છે/.test(gu['ops2.billing.payee'])]).toEqual([true, true, true]);
  });
  it('the Q2-A rule is PINNED in words (once, at release; the rate then; whole 30-day periods rounded up, minimum one; quintals) in every language', () => {
    expect(en['ops2.billing.rule']).toBe('The fee is computed once, at release, from the rate on file at that moment, for whole 30-day periods rounded up (minimum one), on the quantity in quintals.');
    expect([/30-दिन/.test(hi['ops2.billing.rule']) && /क्विंटल/.test(hi['ops2.billing.rule']) && /एक ही बार/.test(hi['ops2.billing.rule']),
      /30-દિવસ/.test(gu['ops2.billing.rule']) && /ક્વિન્ટલ/.test(gu['ops2.billing.rule']) && /એક જ વાર/.test(gu['ops2.billing.rule'])]).toEqual([true, true]);
    expect(en['ops2.billing.rateLabel']).toBe('on file now; the rate at release is used, not the rate when the goods arrived');
    expect(en['ops2.billing.wdraAsEntered']).toBe('{wdra} (as entered, not checked with WDRA)');
  });
  it('brand guard over every new 2c source (pages, views, helpers, the sidebar)', () => {
    for (const rel of SOURCES_2C) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_2C.filter(([r]) => !/Krishalaya Ops/.test(String(r)) || rel !== 'components/Sidebar.tsx')) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

// ── PC-56 OPS-2b (brief §E6): the receipts-and-quality guards over the `ops2.` scope, the three new nav labels and every `wh.` value (a widening:
// the booking pages lost the issue form and the valuation in this wave). Each is proven on its own canon phrase (persons, labs, places and
// references anonymised — the 4a rule) and, where affirmative, also proven to let its negated form through. The founder's words are PINNED.
const NAV_2B = ['nav.whAssay', 'nav.whEnwrRegistry', 'nav.whEnwrIssue'];
const scoped2b = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('ops2.') || k.startsWith('wh.') || NAV_2B.includes(k));
const GUARDS_2B: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated?: string]> = [
  ['certificate (affirmative)', affirmative(/certificat/i), 'Assay certificate — [ref]', 'This page is not a certificate.'],
  ['verified (affirmative)', affirmative(/\bverif(ied|y|ication)\b/i), 'verified · QR · verify at [platform]/c/[ref]', 'Nothing here is verified.'],
  ['accredit (affirmative)', affirmative(/accredit/i), '[lab] Labs (accredited — per certificate face)', 'No lab is accredited here.'],
  ['NABL', plain(/\bNABL\b/), 'Lab registry / accreditation / certificate verification / PDF — legal (NABL)'],
  ['sets the price', plain(/sets the price|price'?s birth certificate/i), 'the assay is the price\'s birth certificate'],
  ['QR', plain(/\bQR\b/), 'verified · QR · verify at [platform]/c/[ref]'],
  ['issued, of an eNWR (affirmative)', affirmative(/\b(e-?NWR|receipt)s?\b.*\bissued\b|\bissued\b.*\b(e-?NWR|receipt)s?\b/i), 'eNWR receipt issued.', 'No receipt is issued here.'],
  ['repository confirmed (affirmative)', affirmative(/repositor\w* confirm|(NERL|CCRL) confirm|confirm(ed|s)? (with|by) (the )?(NERL|CCRL|repositor)/i), 'e-NWRs appear here once NERL confirms issue', 'No receipt is confirmed with the repository.'],
  ['legally / document of record (affirmative)', affirmative(/\blegal(ly)?\b|document[- ]of[- ]record/i), 'Document-of-record', 'No document of record exists here.'],
  ['negotiable (affirmative)', affirmative(/negotiable/i), 'e-NWR (electronic Negotiable Warehouse Receipt)', 'Nothing here is negotiable.'],
  ['pledge (affirmative)', affirmative(/pledg/i), '[ref] · pledged · [bank] loan · sanction vs valuation', 'No receipt is pledged here.'],
  ['transfer (affirmative)', affirmative(/transfer/i), 'the transfer of holding to the buyer', 'There is no transfer.'],
  ['OTP (affirmative)', affirmative(/\bOTP\b/), 'Send OTP to farmer', 'No OTP is sent.'],
  ['valuation (affirmative)', affirmative(/valuation|\bvalued\b/i), 'Valuation [n] qtl × [rate]/qtl', 'No receipt is valued here.'],
  ['₹ (any)', plain(/₹/), 'sanction ₹[n] vs valuation ₹[n]'],
];
const BRAND_2B: ReadonlyArray<[RegExp, string]> = [
  ...BRAND_2C, [/AQ-26-/, 'AQ-26-3308'], [/NERL-26-/, 'NERL-26-GJ-87102'], [/SGB/, 'SGB loan'], [/krishalaya\.in\/c/i, 'krishalaya.in/c/AQ-26-3308'], [/3,90,624|6,240|2,80,000|4,10,000|68\.3/, '₹3,90,624'],
];
const SOURCES_2B = ['components/ops2/AssayViews.tsx', 'components/ops2/EnwrViews.tsx', 'components/ops2/Ops2Chain.tsx', 'features/ops2/receipts.ts',
  'app/warehouse/assay/page.tsx', 'app/warehouse/assay/actions.ts', 'app/warehouse/assay/certificate/page.tsx', 'app/warehouse/enwr/issue/page.tsx',
  // NAMED UPDATE (PC-56 OPS-2a): `app/warehouse/page.tsx` is deleted (`/warehouse` answers a 307); its successor W370 is in SOURCES_2A below.
  'app/warehouse/enwr/registry/page.tsx', 'app/warehouse/enwr/[id]/page.tsx', 'app/warehouse/[id]/page.tsx', 'app/warehouse/actions.ts'];

describe('PC-56 OPS-2b · the claims guard (ops2. + wh. scope, receipts and quality)', () => {
  it('each guard is proven on its own canon phrase; each affirmative guard lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_2B) {
      expect([name, hit(canon)]).toEqual([name, true]);
      if (negated) expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_2B) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no ops2. / wh. value (or 2b nav label) trips a 2b guard or brand regex', (_lang, cat) => {
    // NAMED UPDATE (PC-56 OPS-2a): + the 121 2a `ops2.` keys and the 2 new `wh.error.*` keys, − the 20 superseded `wh.*` keys of the deleted
    // `/warehouse` page (E8: deleted when no route uses them) → 386. A widening of the guarded `ops2.` values; the deleted keys exist nowhere.
    expect(scoped2b(cat).length).toBe(386);
    for (const [k, v] of scoped2b(cat)) {
      for (const [name, hit] of GUARDS_2B) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_2B) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the founder\'s words are PINNED: Q13-A on every assay surface, Q3-A\'s "recorded, not confirmed", and W375\'s statement of fact', () => {
    expect(en['ops2.assay.label']).toBe('Each assay here is the warehouse\'s own entry — not a lab certificate, and it sets no price.');
    expect(en['ops2.assay.label']).toContain('the warehouse\'s own entry — not a lab certificate, and it sets no price');
    expect(en['ops2.enwr.recordedNotConfirmed']).toBe('recorded, not confirmed');
    expect(en['ops2.enwrIssue.statement']).toBe('This platform does not issue an eNWR. No receipt is recorded here in a depositor\'s name.');
    expect(en['wh.noIssue']).toBe(en['ops2.enwrIssue.statement']);
    // "not a lab certificate" and "sets no price" said in every language
    expect([/लैब का प्रमाणपत्र नहीं/.test(hi['ops2.assay.label']) && /कीमत तय नहीं/.test(hi['ops2.assay.label']),
      /લેબનું પ્રમાણપત્ર નહીં/.test(gu['ops2.assay.label']) && /કિંમત નક્કી થતી નથી/.test(gu['ops2.assay.label'])]).toEqual([true, true]);
    expect([/जारी नहीं करता/.test(hi['ops2.enwrIssue.statement']), /જારી કરતું નથી/.test(gu['ops2.enwrIssue.statement'])]).toEqual([true, true]);
  });
  it('W373 is titled "Assay record" — never "certificate" — in EVERY language', () => {
    expect(en['ops2.assayRecord.title']).toBe('Assay record');
    expect([/certificat/i.test(en['ops2.assayRecord.title']), /प्रमाणपत्र|सर्टिफ़िकेट|सर्टिफिकेट/.test(hi['ops2.assayRecord.title']), /પ્રમાણપત્ર|સર્ટિફિકેટ/.test(gu['ops2.assayRecord.title'])]).toEqual([false, false, false]);
    for (const cat of [en, hi, gu]) for (const k of ['ops2.assay.title', 'nav.whAssay']) expect([k, /certificat|प्रमाणपत्र|પ્રમાણપત્ર/i.test(cat[k])]).toEqual([k, false]);
  });
  it('brand guard over every new or changed 2b source (pages, actions, views, helpers)', () => {
    for (const rel of SOURCES_2B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_2B) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

// ── PC-56 OPS-2a (brief §E6): the INTAKE guards over the `ops2.` and `wh.` scope, the warehouse nav labels and the dashboard's warehouse row. Each
// is proven on its own canon phrase (persons, places and references anonymised) and NARROWED TO THE AFFIRMATIVE — a sentence that carries a
// negation passes ("No gross, tare or net reading is recorded"), the canon's claim is caught — and each is also proven to let its negated form
// through. "(weighed)" is PLAIN in all three languages (founder Q6-A: dropped from the label in every language). The founder's words are PINNED.
const NAV_2A = ['nav.warehouse', 'nav.whWeighbridge', 'nav.whStacking', 'nav.whGroupIntake', 'nav.whGroupReceipts', 'nav.whGroupMoney', 'dash.wave.warehouse'];
const scoped2a = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('ops2.') || k.startsWith('wh.') || NAV_2A.includes(k));
const GUARDS_2A: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated?: string]> = [
  ['(weighed) in any language (plain)', plain(/\((weighed|तौला|તોલાયું)\)/i), 'Mark stored (weighed)'],
  ['weighbridge slip (affirmative)', affirmative(/weighbridge slip/i), 'Net received today [n] qtl · weighbridge slip [ref] · [n] kg net', 'No weighbridge slip exists here.'],
  ['gross (affirmative)', affirmative(/\bgross\b/i), 'Gross − tare = net: [n] kg gross', 'No gross reading is recorded.'],
  ['tare (affirmative)', affirmative(/\btare\b/i), '[n] kg tare · [time]', 'No tare is recorded.'],
  ['calibrat (affirmative)', affirmative(/calibrat/i), 'Calibration — Stamping cert ref [ref], valid to [date].', 'No calibration record is kept.'],
  ['Legal Metrology (affirmative)', affirmative(/legal metrology/i), 'Legal Metrology framing: calibration is the law\'s, the record is ours.', 'No Legal Metrology record is kept.'],
  ['bay (affirmative)', affirmative(/\bbays?\b/i), 'Stacking — bay [ref], stack 3', 'No bay is recorded.'],
  ['stack N (affirmative)', affirmative(/\bstack \d/i), 'Location Bay [ref] · stack 3', 'No stack 3 exists here.'],
  ['pest (affirmative)', affirmative(/\bpest/i), 'Log pest-control check', 'No pest-control check is logged.'],
  ['quarantin (affirmative)', affirmative(/quarantin/i), 'Pest alert — bay quarantined', 'Nothing is quarantined.'],
  ['centre manager (affirmative)', affirmative(/centre manager/i), 'releasing stock, revising the rate card and viewing storage revenue are the centre manager\'s', 'No centre manager role exists.'],
  ['gate staff (affirmative)', affirmative(/gate staff/i), 'Gate staff see today\'s bookings and the weighbridge queue', 'No gate staff role exists.'],
  ['as of N (affirmative)', affirmative(/\bas of \d/i), 'Dashboard figures as of 09:00', 'No figure is shown as of 9 or any time.'],
  ['of N (affirmative)', affirmative(/\bof \d/i), 'Showing 1 of 1 booking today · Page 1 of 1', 'No count of 1 or more is shown.'],
  ['New booking, offered (affirmative)', affirmative(/\bnew booking\b/i), 'New booking', 'New booking: not available'],
  ['weighed in (affirmative)', affirmative(/\bweighed in\b/i), 'Bookings appear the moment a farmer\'s lot is weighed in', 'No lot is weighed in here.'],
];
const BRAND_2A: ReadonlyArray<[RegExp, string]> = [
  [/Gondal/i, 'Gondal Agri Warehouse'], [/Anand FPO/i, 'Anand FPO · warehouse ops'], [/Ramesh Patel/i, 'Ramesh Patel, GG-20 groundnut'], [/Paresh V\./, 'the centre manager\'s (Paresh V.)'],
  [/SB-2026-|WB-0713|GJ-1•|W&M ••318|B-14|B-09|GG-20/, 'Slip WB-0713-041 · booking SB-2026-0871'], [/62\.60|6,260|12,480|6,220/, 'Net = 62.60 qtl'],
];
const SOURCES_2A = ['features/ops2/intake.ts', 'components/ops2/IntakeViews.tsx', 'app/warehouse/dashboard/page.tsx', 'app/warehouse/weighbridge/page.tsx',
  'app/warehouse/stacking/page.tsx', 'app/warehouse/[id]/page.tsx', 'app/warehouse/actions.ts', 'components/Sidebar.tsx'];

describe('PC-56 OPS-2a · the claims guard (ops2. + wh. scope, intake)', () => {
  it('each guard is proven on its own canon phrase; each affirmative guard lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_2A) {
      expect([name, hit(canon)]).toEqual([name, true]);
      if (negated) expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_2A) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no ops2. / wh. value (or warehouse nav label) trips a 2a guard or brand regex', (_lang, cat) => {
    expect(scoped2a(cat).length).toBe(390);
    for (const [k, v] of scoped2a(cat)) {
      for (const [name, hit] of GUARDS_2A) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_2A) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('founder Q6-A: the store label is exactly "Mark stored" in English and carries no "(weighed)" in any language', () => {
    expect(en['wh.actStore']).toBe('Mark stored');
    for (const cat of [en, hi, gu]) expect([cat['wh.actStore'], /\(/.test(cat['wh.actStore'])]).toEqual([cat['wh.actStore'], false]);
  });
  it('the founder\'s words and the code-proved facts are PINNED: Q12-A, release paused, the weighbridge three, the stacking two', () => {
    expect(en['ops2.whDash.newBooking']).toBe('A booking is the depositor\'s own request. She cannot yet make one on this platform.');
    expect(en['ops2.whDash.releasePaused']).toBe('Release is paused for everyone.');
    expect(en['ops2.weighbridge.statement']).toBe('This platform records no weighment.');
    expect(en['ops2.weighbridge.store']).toBe('Marking goods stored records no weight.');
    expect(en['ops2.weighbridge.quantity']).toBe('The quantity on a booking and on its receipt is the quantity the depositor asked to store.');
    expect(en['ops2.weighbridge.fee']).toBe('If release were switched on, the storage fee would be computed from that same quantity.');
    expect(en['ops2.stacking.statement']).toBe('Where goods sit in the warehouse is not recorded on this platform, and neither is pest control.');
    expect(en['ops2.stacking.receipt']).toBe('No receipt on this platform carries a location.');
    expect([/स्वयं|अपना अनुरोध/.test(hi['ops2.whDash.newBooking']), /પોતાની વિનંતી/.test(gu['ops2.whDash.newBooking'])]).toEqual([true, true]);
  });
  it('brand guard over every new or changed 2a source', () => {
    for (const rel of SOURCES_2A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_2A) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

describe('PC-56 OPS-1c · the claims guard (ops1. scope, the kiosk)', () => {
  it('each guard is proven on its own canon phrase; each affirmative guard lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_1C) {
      expect([name, hit(canon)]).toEqual([name, true]);
      if (negated) expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_1C) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no ops1. value (or kiosk nav label) trips a 1c guard or brand regex', (_lang, cat) => {
    for (const [k, v] of scoped(cat)) {
      for (const [name, hit] of GUARDS_1C) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_1C) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the founder\'s kiosk sentences are PINNED verbatim (Q4-A′, Q9-A, Q11-A, the chain\'s three states)', () => {
    expect(en['ops1.kiosk.summary.pay']).toBe('Creating your account at this desk pays the helper nothing, and you pay nothing.');
    expect(en['ops1.kiosk.reason.exists']).toBe('This number already has an account. She signs in herself, on her own phone.');
    expect(en['ops1.kiosk.summary.helpline']).toBe('Your organisation\'s helpline is not published yet.');
    expect(en['ops1.kiosk.summary.undo']).toBe('Nothing done here can be undone from this desk. She manages her own account and data in her own sign-in.');
    expect(en['ops1.kiosk.summary.did']).toMatch(/^What this desk did: an account was created for this number/);
    expect(en['ops1.chain.kioskAct.confirm.title']).toBe('Create an account for this number');
    expect(en['ops1.chain.kioskAct.success.title']).toBe('An account exists for this number; she signs in on her own phone');
    expect(en['ops1.chain.kioskAct.failure.title']).toBe('Nothing was created');
    // Q4-A′: no amount anywhere in the summary, in any language (no digit at all), and "nothing" said for both people
    for (const cat of [en, hi, gu]) for (const k of ['ops1.kiosk.summary.pay', 'ops1.kiosk.summary.did', 'ops1.kiosk.summary.helpline', 'ops1.kiosk.summary.undo']) expect([k, /\d|₹/.test(cat[k])]).toEqual([k, false]);
    expect([/कुछ नहीं/.test(hi['ops1.kiosk.summary.pay']), /કંઈ/.test(gu['ops1.kiosk.summary.pay'])]).toEqual([true, true]);
    // Q10-A: the link text says what happens
    expect(en['ops1.kiosk.step.start']).toBe('Create an account for a new number');
  });
  it('brand guard over every new ops1c source (pages, actions, views, helpers)', () => {
    for (const rel of SOURCES_1C) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of [...BRAND_1A.filter(([r]) => !String(r).includes('₹')), ...BRAND_1B, ...BRAND_1C]) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

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

// ── PC-56 OPS-3c (brief §E6): THE PRICE guards over the `ops3.` scope and the two new nav labels. Each is proven on its own canon phrase (persons,
// places, card numbers and figures anonymised) and NARROWED TO THE AFFIRMATIVE — a sentence that carries a negation passes, the canon's claim is
// caught — and each affirmative guard is also proven to let its negated form through. The negation is read in all three languages here (an
// `ops3.` refusal in Hindi or Gujarati says "SMS … नहीं" / "SMS … નથી"). The plain guards (zero-sum, on-call, ×, =, litre) never pass. The
// change sentence is PINNED in every language, and a brand guard runs over the 3c sources.
const NEG3 = /\b(not|no|never|nothing|none|cannot|nobody)\b|n't\b|नहीं|मत\b|કોઈ નહીં|નહીં|નથી/i;
const affirmative3 = (re: RegExp) => (v: string) => sentences(v).some((x) => re.test(x) && !NEG3.test(x));
const NAV_3C = ['nav.dairyGroup', 'nav.rates'];
const scoped3 = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('ops3.') || NAV_3C.includes(k));
const GUARDS_3C: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated?: string]> = [
  ['versioned (affirmative)', affirmative3(/versioned/i), 'v3 effective 01 Jul (versioned — every pour stores its rate_card_id, so old slips recompute forever)', 'Cards are not versioned.'],
  // PLAIN: the canon's own version line carries "never", so the affirmative narrowing would let it through; no `ops3.` value names a version.
  ['v<n> (plain)', plain(/\bv\d\b/i), 'v3 effective 01 Jul (versioned — every pour stores its rate_card_id)'],
  ['never change quietly (plain)', plain(/never change quietly/i), 'Version history — rates never change quietly'],
  ['announced … ahead (affirmative)', affirmative3(/announced .* ahead/i), 'Every change announced 7 days ahead on the counter poster, the app and SMS', 'No change is announced days ahead.'],
  ['board minute (affirmative)', affirmative3(/board minute/i), 'Changing needs the tenant dairy desk + board minute reference — recorded.', 'No board minute is recorded with a card.'],
  ['poster / A2, offered (affirmative)', affirmative3(/\bposter\b|\bA2\b/i), 'Print counter poster (A2, [lang])', 'Print counter poster: not available'],
  ['ready-reckoner (affirmative)', affirmative3(/ready[- ]reckoner/i), 'Ready-reckoner — ₹ per kg of milk · fat% \\ SNF%', 'No ready-reckoner is shown.'],
  ['recompute (affirmative)', affirmative3(/recompute/i), 'every pour stores its rate_card_id, so old slips recompute forever', 'Nothing is recomputed.'],
  ['cached card (affirmative)', affirmative3(/cached card/i), 'POS keeps pricing from its cached card (the version is printed on every slip)', 'There is no cached card.'],
  ['SMS (affirmative)', affirmative3(/\bSMS\b/), 'Every change announced 7 days ahead on the counter poster, the app and SMS', 'No SMS is sent about a rate card.'],
  ['audit trail (affirmative)', affirmative3(/audit[- ]trail/i), 'The change is applied and the audit trail has the entry (actor · time · reason · before/after).', 'No audit trail is shown on this console.'],
  ['zero-sum (plain)', plain(/zero-sum/i), 'Money-adjacent actions reconcile zero-sum before this page ever shows.'],
  ['reconcil (plain)', plain(/reconcil/i), 'Money-adjacent actions reconcile zero-sum before this page ever shows.'],
  ['on-call (plain)', plain(/on-call/i), 'repeated failures page the on-call.'],
  ['per litre / L applied to milk (plain)', plain(/litre|liter|\/L\b|per L\b|₹\/L/i), 'Bonus slab: fat ≥ 6.5 → +₹0.50/L'],
  ['× or = (plain)', plain(/[×=]/), '₹/kg = fat% × 6.80 + SNF% × 2.30'],
  ['a rupee figure (plain)', plain(/₹\s?\d/), 'fat ₹680/kg-fat + SNF ₹230/kg-SNF'],
  ['plan settings (plain)', plain(/plan settings/i), 'Nothing is broken — it is not enabled. See plan settings.'],
  ['supervisor / witness / PIN (affirmative, Q14-A)', affirmative3(/supervisor|witness|\bPIN\b/i), 'Changing needs a supervisor PIN and a member-witness', 'No witness or PIN is asked for.'],
];
const BRAND_3C: ReadonlyArray<[RegExp, string]> = [
  [/Vanthali/i, 'Vanthali MCC'], [/Anand/i, 'Anand FPO · dairy ops'], [/Jayaben/i, 'Operator: Jayaben S.'], [/Meera/i, 'exactly Meera Ben\'s slip'],
  [/RC-20\d\d/, 'Rate card RC-2026-07'], [/VS-0713/, 'VS-0713-M-0188'], [/\b214\b/, '214 member pourers'], [/67\.17|60\.35|70\.12/, '= ₹67.17'],
];
const SOURCES_3C = ['components/ops3/RatesView.tsx', 'components/ops3/Ops3Chain.tsx', 'app/rates/page.tsx', 'features/ops3/rates.ts', 'features/ops3/refusals.ts', 'components/Sidebar.tsx'];

describe('PC-56 OPS-3c · the claims guard (ops3. scope, the price)', () => {
  it('each guard is proven on its own canon phrase; each affirmative guard lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_3C) {
      expect([name, hit(canon)]).toEqual([name, true]);
      if (negated) expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_3C) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
    // the trilingual negation is itself proven: a Hindi / Gujarati refusal that names SMS passes, the bare claim does not
    expect([affirmative3(/\bSMS\b/)('कोई SMS नहीं भेजा जाता।'), affirmative3(/\bSMS\b/)('કોઈ SMS મોકલાતો નથી.'), affirmative3(/\bSMS\b/)('SMS भेजा जाता है।')]).toEqual([false, false, true]);
  });
  it.each(Object.entries(CATS))('%s: no ops3. value (or 3c nav label) trips a 3c guard or brand regex', (_lang, cat) => {
    // NAMED UPDATE (PC-56 OPS-3a): 94 → 282 — the counter's 188 `ops3.` keys join the scope, and every 3c guard holds over them too.
    // NAMED UPDATE (PC-56 OPS-3b): 282 → 400 — the tank's 119 `ops3.` keys join (W365's false "no cooler page" key replaced by its link, −1).
    expect(scoped3(cat).length).toBe(400);
    for (const [k, v] of scoped3(cat)) {
      for (const [name, hit] of GUARDS_3C) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_3C) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the change sentence is PINNED (only the clauses the code proves at merge), in every language', () => {
    expect(en['ops3.rates.notHere']).toBe('Rates are changed on your organisation\'s dairy console, not here.');
    expect([/यहाँ नहीं/.test(hi['ops3.rates.notHere']), /અહીં નહીં/.test(gu['ops3.rates.notHere'])]).toEqual([true, true]);
    expect([/दूसरा व्यक्ति/.test(hi['ops3.rates.secondPerson']), /બીજી વ્યક્તિ/.test(gu['ops3.rates.secondPerson'])]).toEqual([true, true]);
    expect([/कल/.test(hi['ops3.rates.tomorrow']), /આવતીકાલ/.test(gu['ops3.rates.tomorrow'])]).toEqual([true, true]);
    expect([/अपनी भाषा/.test(hi['ops3.rates.told']), /પોતાની ભાષા/.test(gu['ops3.rates.told'])]).toEqual([true, true]);
    // what is NOT built is never said: no notice period, no SMS, no version, no "quietly", no board
    for (const cat of [en, hi, gu]) for (const k of ['ops3.rates.notHere', 'ops3.rates.secondPerson', 'ops3.rates.tomorrow', 'ops3.rates.recorded', 'ops3.rates.oneInForce', 'ops3.rates.told'])
      expect([k, /SMS|quietly|version|board|7 days|\d/i.test(cat[k])]).toEqual([k, false]);
  });
  it('brand guard over every new or changed 3c source', () => {
    for (const rel of SOURCES_3C) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_3C) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

// ── PC-56 OPS-3a (brief §E6): THE COUNTER guards over the counter's keys (`ops3.pos.*`, `ops3.chain.posAct.*`, the 3a refusals) and its four nav
// labels. Each is proven on its OWN canon phrase (persons, places and figures anonymised) and NARROWED TO THE AFFIRMATIVE — a sentence that carries
// a negation passes, the canon's claim is caught — and each is proven to let its negated form through. Then the founder's option words are PINNED
// in English (and their presence asserted in hi / gu), and a brand guard runs over every 3a source.
const NAV_3A = ['nav.posHome', 'nav.posCollect', 'nav.posShift', 'nav.posExceptions'];
const is3a = (k: string) => k.startsWith('ops3.pos.') || k.startsWith('ops3.chain.posAct.') || /^ops3\.refusal\.pos[A-Z]/.test(k) || NAV_3A.includes(k);
const scoped3a = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => is3a(k));
const GUARDS_3A: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated: string]> = [
  ['accept(ed) reading / by', affirmative3(/accept(ed)? (the )?(reading|by)/i), 'Tap \'Accept reading\' — the reading shows on the farmer zone FIRST', 'She is not asked to accept the reading.'],
  // the canon's own line carries "not private", so it is caught PLAIN (no counter value names a joint acceptance at all); its negated form too
  ['acceptance is joint (plain)', plain(/acceptance is joint|agreed by both/i), 'acceptance is joint, not private (W362)', 'She is not asked to agree to the reading.'],
  ['machines read', affirmative3(/machines? (do the )?read/i), 'Machines do the reading; taps are only for consent', 'No machine reads anything here.'],
  ['scale reads', affirmative3(/scale reads|weigher .*read/i), 'Pour → weigher + lactoscan read automatically', 'No scale reads the weight.'],
  ['analyser read', affirmative3(/analy[sz]er read|read automatically|lactoscan/i), 'Analyzer (lactoscan) — read automatically', 'Nothing is read automatically.'],
  // the canon prints "slip VS-[ref]"; "slip no." itself carries the word "no", so it is spelled out BEFORE the negation test (else "Slip no. 1"
  // would read as a refusal — found by mutant M9) and the guard is proven on both spellings
  ['slip no. / slip number', (v: string) => affirmative3(/slip number/i)(v.replace(/slip no\./gi, 'slip number')), 'Her proof: slip no. 0188, printed in seconds', 'No slip number is given.'],
  ['QR', affirmative3(/\bQR\b/), 'QR → verify this slip online', 'No QR code exists.'],
  ['reprint', affirmative3(/reprint/i), 'Slip reprint — Member + date + shift → reprint (marked REPRINT). Free, always', 'Nothing is reprinted.'],
  ['SMS', affirmative3(/\bSMS\b/), 'SMS mirror to +91 98••• ••000', 'No SMS is sent.'],
  ['printed slip', affirmative3(/printed slip|slip (is )?printed|prints? (the |a )?slip/i), 'The slip — her proof, printed in seconds · the slip is printed MANUAL', 'No slip is printed.'],
  ['witness', affirmative3(/witness/i), 'Operator + one witness (any member) enter fat/SNF together', 'No witness is asked for.'],
  ['supervisor PIN', affirmative3(/supervisor PIN|\bPIN\b/i), 'needs reason + supervisor PIN, becomes TWO records with a link', 'No supervisor PIN exists.'],
  ['centre manager', affirmative3(/centre manager|center manager/i), 'dispatch requests and alarm-threshold changes are the centre manager\'s', 'No centre manager role exists.'],
  ['offline / on this device / syncs', affirmative3(/offline|on this device|\bsyncs?\b|synced/i), 'Offline-first: every pour saves on this device and syncs when signal allows', 'Nothing is saved on this device or synced later.'],
  ['cash (handed over)', affirmative3(/\bcash\b/i), 'cash handed over at the counter is counted at the shift\'s recon', 'This console records no cash.'],
  ['variance', affirmative3(/variance/i), 'variance 0.96 kg (0.05%) within 0.1% — can-film loss, normal', 'No variance is worked out.'],
  ['close shift (offered)', affirmative3(/close (this |the |morning |evening )?shift/i), 'Close shift & hand to BMC', 'Close shift: not available.'],
  ['correct(ion) record', affirmative3(/correct(ion)? record|correction record/i), 'a correction record reverses and re-enters (both slips print, both link)', 'No correction record exists.'],
];
const BRAND_3A: ReadonlyArray<[RegExp, string]> = [
  [/Vanthali/i, 'Vanthali MCC'], [/Anand/i, 'Anand FPO'], [/Jayaben/i, 'Operator: Jayaben S.'], [/Meera/i, 'Meera Ben D. · #0781'],
  [/મીરા|मीरा/, 'મીરા બેન ડી.'], [/#0781|\b0781\b/, 'member #0781'], [/VS-0713/, 'VS-0713-M-0188'], [/1800-419|\*123#/, '1800-419-0123 · *123#'],
  [/537\.36|67\.17|1,03,643|1,19,584|64\.90|1,842\.60|1,598\.2/, '= ₹537.36'],
];
const SOURCES_3A = ['components/ops3/CounterViews.tsx', 'features/ops3/counter.ts', 'features/ops3/counter-load.ts', 'app/pos/actions.ts', 'app/pos/home/page.tsx',
  'app/pos/collect/page.tsx', 'app/pos/quality/page.tsx', 'app/pos/slip/page.tsx', 'app/pos/exceptions/page.tsx', 'app/pos/shift-close/page.tsx', 'features/ops3/refusals.ts'];

describe('PC-56 OPS-3a · the claims guard (the counter)', () => {
  it('each guard is proven on its own canon phrase and lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_3A) {
      expect([name, hit(canon)]).toEqual([name, true]);
      expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_3A) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no counter value trips a 3a guard or a brand regex', (_lang, cat) => {
    expect(scoped3a(cat).length).toBe(192);
    for (const [k, v] of scoped3a(cat)) {
      for (const [name, hit] of GUARDS_3A) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_3A) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the founder\'s option words and the proved facts are PINNED (en), and present in hi / gu', () => {
    const PIN: Record<string, string> = {
      'ops3.pos.recordBtn': 'Record this pour',
      'ops3.pos.typed': 'These numbers were typed by the person at this counter — not read from a scale or an analyser.',
      'ops3.pos.payFromThem': 'Her pay is computed from them, and they cannot be changed afterwards.',
      'ops3.pos.diary': 'She can check this pour in her milk diary and object to her bill in its window.',
      'ops3.pos.cannotCorrect': 'A recorded pour cannot be corrected here.',
      'ops3.pos.onePour': 'Only one pour can be recorded for a member in each shift.',
      'ops3.pos.pricedCaveat': 'Held or rejected pours are inside this figure.',
      'ops3.pos.slip.title': 'What was recorded',
      'ops3.pos.signedIn': 'Signed in as you. A pour you record is recorded under you.',
      'ops3.pos.reason.future': 'A pour cannot be recorded for a day after today.',
      'ops3.pos.shiftPage.closeRefused': 'Close shift: not available. This platform keeps no shift record, so a shift is not opened, closed or signed here.',
    };
    for (const [k, v] of Object.entries(PIN)) expect([k, en[k]]).toEqual([k, v]);
    for (const k of Object.keys(PIN)) for (const cat of [hi, gu]) expect([k, typeof cat[k] === 'string' && cat[k] !== en[k]]).toEqual([k, true]);
    expect([/दूध डायरी/.test(hi['ops3.pos.diary']), /દૂધ ડાયરી/.test(gu['ops3.pos.diary'])]).toEqual([true, true]);
    expect([/सुधारा नहीं/.test(hi['ops3.pos.cannotCorrect']), /સુધારી શકાતું નથી/.test(gu['ops3.pos.cannotCorrect'])]).toEqual([true, true]);
    // no counter value says "accept" affirmatively (en); the act's label is never W362's "મંજૂર" / "मंजूर" in hi / gu (there it means the
    // APPROVED card, which the counter does name — so only the button and the chain titles are checked)
    for (const [k, v] of scoped3a(en)) expect([k, /accept/i.test(v) && !NEG3.test(v)]).toEqual([k, false]);
    for (const cat of [hi, gu]) for (const k of ['ops3.pos.recordBtn', 'ops3.chain.posAct.confirm.title', 'ops3.chain.posAct.success.title', 'nav.posCollect'])
      expect([k, /मंजूर|મંજૂર|स्वीकार/.test(cat[k])]).toEqual([k, false]);
  });
  it('brand guard over every new or changed 3a source', () => {
    for (const rel of SOURCES_3A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_3A) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

// ── PC-56 OPS-3b (brief §E6): THE TANK guards over the cooler's keys (`ops3.bmc.*`, `ops3.chain.bmcForm.*`, `ops3.chain.bmcAct.*`, the 3b refusals) and
// its nav label. Each is proven on its OWN canon phrase (W366 and its chains; persons, places and figures anonymised) and NARROWED TO THE
// AFFIRMATIVE — a sentence that carries a negation passes, the canon's claim is caught — and each is proven to let its negated form through. Then the
// founder's option words and the code-proved facts are PINNED in English (present in hi / gu), and a brand guard runs over every 3b source.
const NAV_3B = ['nav.bmc'];
const is3b = (k: string) => k.startsWith('ops3.bmc.') || k.startsWith('ops3.chain.bmcForm.') || k.startsWith('ops3.chain.bmcAct.') || /^ops3\.refusal\.bmc[A-Z]/.test(k) || NAV_3B.includes(k);
const scoped3b = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => is3b(k));
const GUARDS_3B: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated: string]> = [
  ['tanker', affirmative3(/tanker/i), 'Fill level 1,788 L of 2,000 — evening shift needs the 11:00 tanker', 'No tanker exists on this platform.'],
  ['dispatch (offered)', affirmative3(/\bdispatch/i), 'Request tanker dispatch', 'Request tanker dispatch: not available.'],
  ['manifest', affirmative3(/manifest/i), 'Dispatch — 11:00 tanker · Manifest: 1,788 L · composite 6.5/9.0', 'No manifest exists.'],
  ['seal', affirmative3(/\bseal/i), 'sealed with numbered seals (photographed)', 'No seal is recorded.'],
  ['reconcil', affirmative3(/reconcil/i), 'MCC\'s litres and the dairy\'s litres reconcile per trip, to the litre, same day.', 'Nothing is reconciled here.'],
  ['agitator', affirmative3(/agitator/i), 'target ≤ 4.0 · agitator running ✓', 'No agitator is recorded.'],
  ['CIP', affirmative3(/\bCIP\b/), 'Post-dispatch state: cleaned, agitator off, next fill = evening shift. CIP wash log attaches here.', 'No CIP log exists.'],
  ['photo (required)', affirmative3(/photo/i), 'Manual thermometer reading every 30 min with photo until the sensor returns', 'No photo is taken or attached.'],
  ['centre manager', affirmative3(/centre[- ]manager|center[- ]manager/i), 'dispatch requests and alarm-threshold changes are the centre manager\'s (MM), recorded.', 'There is no centre-manager role.'],
  ['operator vs manager', affirmative3(/operators? vs\.? managers?|operator .*manager/i), 'Operator vs manager — Operators see and log', 'There is no operator or manager role here.'],
  ['a level as a percentage', affirmative3(/\d+ ?%/), 'Fill level 1,788 L of 2,000 (89%)', 'No 89% is shown.'],
  // the canon says it only NEGATED ("disclosed-not-interpolated", W366:70): the bare regex is proven on that phrase below; the affirmative guard is
  // proven on the claim it exists to stop — a page that says its series is interpolated
  ['interpolat (affirmative)', affirmative3(/interpolat/i), 'Temperature trail — since morning open: the readings are interpolated into one line.', 'Nothing is interpolated.'],
  ['travels with', affirmative3(/travels with/i), 'weighted fat/SNF of the morning pool · travels with the tanker manifest', 'Nothing travels with a manifest.'],
  ['weighbridge', affirmative3(/weighbridge/i), 'dairy-side weighbridge closes the loop', 'No weighbridge record exists here.'],
  ['maker-checker', affirmative3(/maker[- ]checker/i), 'Maker-checker friendly review step: everything you entered, shown read-only', 'No maker-checker step exists.'],
];
const BRAND_3B: ReadonlyArray<[RegExp, string]> = [
  [/Vanthali/i, 'Vanthali MCC'], [/Anand/i, 'Anand FPO · dairy ops'], [/\bMM\b/, 'the centre manager\'s (MM)'], [/\b214\b/, '214 member pourers'],
  [/1,788|2,000 L|11:00 tanker|6\.5 ?\/ ?9\.0/, '1,788 L of 2,000 · 11:00 tanker · 6.5 / 9.0'], [/\bW306\b/, 'the W306 rule'],
];
const SOURCES_3B = ['components/ops3/BmcViews.tsx', 'features/ops3/bmc.ts', 'app/bmc/page.tsx', 'app/bmc/actions.ts', 'features/ops3/refusals.ts', 'components/ops3/Ops3Chain.tsx', 'components/Sidebar.tsx'];

describe('PC-56 OPS-3b · the claims guard (the tank)', () => {
  it('each guard is proven on its own canon phrase and lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_3B) {
      expect([name, hit(canon)]).toEqual([name, true]);
      expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_3B) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
    expect(/interpolat/i.test('the trail continues on paper rather than pausing (disclosed-not-interpolated, W306).')).toBe(true);
  });
  it.each(Object.entries(CATS))('%s: no cooler value trips a 3b guard or a brand regex', (_lang, cat) => {
    expect(scoped3b(cat).length).toBe(119);
    for (const [k, v] of scoped3b(cat)) {
      for (const [name, hit] of GUARDS_3B) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_3B) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the founder\'s option words and the code-proved facts are PINNED (en), and present in hi / gu', () => {
    const PIN: Record<string, string> = {
      // Q12-A, the option's own words
      'ops3.bmc.readsOnly': 'This console reads the cooler and records manual readings only.',
      'ops3.bmc.settingsElsewhere': 'A cooler\'s band, level, compressor and retirement are set on your organisation\'s dairy console, not here.',
      'ops3.bmc.dispatchRefused': 'Request tanker dispatch: not available. No tanker, dispatch or manifest exists on this platform.',
      // Q13-A: labelled as manual, no photo — each clause proved at merge (bmc-reading.service.ts; 0201's breach rule; ops-alert.repository.ts)
      'ops3.bmc.manual.label': 'A manual reading is typed by a person and recorded at the moment it is entered, by the server\'s clock.',
      'ops3.bmc.manual.noBreach': 'It never opens a breach: a breach is opened only by two sensor readings in a row outside the band.',
      'ops3.bmc.manual.alertRule': 'An alert rule your organisation set that counts readings outside the band counts it too.',
      'ops3.bmc.manual.noPhoto': 'No photo is taken or attached.',
      'ops3.bmc.manual.title': 'Log manual reading',
      'ops3.bmc.levelValue': '{volume} L, stated by a person at {at}',
      'ops3.bmc.signedIn': 'Signed in as you.',
      'ops3.bmc.reason.custody': 'You do not hold this cooler\'s centre, so the reading was refused. Custody is given on your organisation\'s dairy console. Nothing was recorded.',
    };
    for (const [k, v] of Object.entries(PIN)) expect([k, en[k]]).toEqual([k, v]);
    for (const k of Object.keys(PIN)) for (const cat of [hi, gu]) expect([k, typeof cat[k] === 'string' && cat[k] !== en[k]]).toEqual([k, true]);
    // "manual" is said in every language on the label and the form's title (a mutant drops it from one)
    expect([/हाथ से/.test(hi['ops3.bmc.manual.label']), /હાથે/.test(gu['ops3.bmc.manual.label'])]).toEqual([true, true]);
    expect([/हाथ से/.test(hi['ops3.bmc.manual.title']), /હાથે/.test(gu['ops3.bmc.manual.title'])]).toEqual([true, true]);
    expect([/manual/i.test(en['ops3.bmc.manual.label']), /manual/i.test(en['ops3.bmc.manual.title'])]).toEqual([true, true]);
    // the stated level says "a person" in every language, and no value ever says "sensor silent" (the tile carries no source)
    expect([/व्यक्ति/.test(hi['ops3.bmc.levelValue']), /વ્યક્તિ/.test(gu['ops3.bmc.levelValue'])]).toEqual([true, true]);
    for (const [k, v] of scoped3b(en)) expect([k, /sensor (is )?silent/i.test(v)]).toEqual([k, false]);
    // "the organisation's console" for the settings, in hi / gu too
    expect([/यहाँ नहीं/.test(hi['ops3.bmc.settingsElsewhere']), /અહીં નહીં/.test(gu['ops3.bmc.settingsElsewhere'])]).toEqual([true, true]);
  });
  it('brand guard over every new or changed 3b source', () => {
    for (const rel of SOURCES_3B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_3B.filter(([r]) => !/W306|MM/.test(String(r)))) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

// ── PC-56 OPS-4a (brief §E "Guards"): THE HIRE guards over the `ops4.` scope and the hire nav labels. Each is proven on its OWN canon phrase
// (W405–W409 and the two mutate chains; persons, machines and figures anonymised) and NARROWED TO THE AFFIRMATIVE — a sentence that carries a
// negation passes, the canon's claim is caught — and each is proven to let its negated form through. Then the founder's words (Q1-A with the
// lead's no-renter-app fact, Q2-A, Q3-A) are PINNED verbatim in English and by their key words in hi / gu, and a brand guard (survey F-16) runs
// over every 4a source, fixture and value.
const NAV_4A = ['nav.chcGroup', 'nav.chcDashboard', 'nav.chcBookings', 'nav.chcInsights', 'dash.wave.chc'];
const scoped4 = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('ops4.') || NAV_4A.includes(k));
const GUARDS_4A: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated: string]> = [
  // money
  ['zero-sum', affirmative3(/zero-sum/i), 'Money-adjacent actions reconcile zero-sum before this page ever shows.', 'Nothing is reconciled zero-sum here, because nothing moves.'],
  ['revenue', affirmative3(/revenue/i), 'Revenue MTD ₹[n] across all rate_basis lines', 'No revenue is shown.'],
  ['utilisation', affirmative3(/utili[sz]ation/i), 'Utilization MTD Tractors — [n]%', 'No utilisation is shown.'],
  ['of N (a ratio)', affirmative3(/\bof \d/i), 'Showing 4 of 87 this month', 'No count such as 4 of 87 is shown.'],
  ['× (a product)', affirmative3(/×/), '6h × ₹950 = ₹5,700 est', 'Nothing like 6h × a rate is worked out: no.'],
  ['= producing a number', affirmative3(/=\s*[₹\d]/), '8 tractors + 4 rotavators = 22', 'No total = 22 is printed.'],
  ['MTD', affirmative3(/\bMTD\b/), 'Revenue MTD ₹[n]', 'No MTD figure exists.'],
  ['subsidy', affirmative3(/subsid/i), 'Machinery-subsidy claims are the FPO\'s own filing … the subsidy file quotes them', 'No subsidy filing is supported.'],
  // hire
  ['disputed', affirmative3(/disput/i), 'hours logged 7.5 vs billed 9 · disputed', 'A hire cannot be disputed.'],
  ['waitlist', affirmative3(/wait-?list|waiting list/i), 'the second is offered the waitlist', 'There is no waiting list.'],
  ['first-come', affirmative3(/first[- ]come/i), 'first-come holds the slot', 'Nothing is first-come here: no slot is held.'],
  ['odometer', affirmative3(/odometer/i), 'odometer step … synced', 'No odometer is read.'],
  ['GPS', affirmative3(/\bGPS\b/), 'the tractor\'s own GPS trail decides — freeze only the disputed part', 'No GPS trail is recorded.'],
  ['technician', affirmative3(/technician/i), 'only the maintenance technician', 'There is no technician role.'],
  ['CHC manager', affirmative3(/CHC manager|centre manager|operator vs/i), 'Operator vs CHC manager — only the CHC manager edits rate cards', 'There is no CHC manager role.'],
  // chrome
  ['on-call', affirmative3(/on-call/i), 'repeated failures page the on-call.', 'Nobody on-call is paged: no.'],
  ['audit trail', affirmative3(/audit[- ]trail/i), 'confirming writes an audit-trail entry with actor, time and reason', 'No audit trail is written when a page is read.'],
];
/** survey F-16 — real-sounding canon fixtures and figures: never in an ops4 value, source or fixture. */
const BRAND_4A: ReadonlyArray<[RegExp, string]> = [
  [/Anand/i, 'Anand FPO'], [/Kisan Mitra/i, 'Kisan Mitra Kiosk'], [/Kiran Ben/i, 'Kiran Ben V.'], [/Jashoda/i, 'Jashoda Ben R.'], [/R••• M\./, 'R••• M.'],
  [/Vanthali/i, 'Vanthali'], [/BMC-VAN-01|SP-BHE-07|SP-VAN-12|\bWM-02\b|\bVB-01\b|REF-114/, 'BMC-VAN-01 · SP-BHE-07 · WM-02 · VB-01 · REF-114'],
  [/\bT-03\b/, 'Tractor T-03'], [/Mahindra/i, 'Mahindra 575 DI'], [/GJ-1•/, 'GJ-1•-••-2214'], [/8802 41/, '8802 41•• ••62'], [/Jaffarabadi/i, 'Jaffarabadi'],
  [/ORD-0713-0442/, 'ORD-0713-0442'], [/BK-2026-04\d\d/, 'BK-2026-0455'], [/2,84,650|52,250|5,700|6,800|18,400|78,000/, '₹2,84,650 · ₹52,250'], [/\b1,840\b|\b1,900\b/, '1,840 / 1,900 engine-hours'],
];
const SOURCES_4A = ['components/ops4/ChcViews.tsx', 'components/ops4/Ops4Chain.tsx', 'features/ops4/chc.ts', 'features/ops4/refusals.ts', 'app/chc/dashboard/page.tsx',
  'app/chc/equipment-detail/page.tsx', 'app/chc/bookings/page.tsx', 'app/chc/insights/page.tsx', 'test-render/ops4a-fixtures.ts', 'components/Sidebar.tsx'];

describe('PC-56 OPS-4a · the claims guard (ops4. scope, the hire)', () => {
  it('each guard is proven on its own canon phrase and lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_4A) {
      expect([name, hit(canon)]).toEqual([name, true]);
      expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
    for (const [re, phrase] of BRAND_4A) expect([String(re), re.test(phrase)]).toEqual([String(re), true]);
  });
  it.each(Object.entries(CATS))('%s: no ops4. value (or hire nav label) trips a 4a guard or a brand regex', (_lang, cat) => {
    // NAMED UPDATE (PC-56 OPS-4b): 4b's 96 `ops4.` values join the scope (a widening: every 4a guard now also runs over them) — 171 → 267.
    expect(scoped4(cat).length).toBe(267);
    for (const [k, v] of scoped4(cat)) {
      for (const [name, hit] of GUARDS_4A) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_4A) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the founder\'s words are PINNED verbatim (en) and carried by their key words in hi / gu; the lead\'s no-renter-app fact beside Q1', () => {
    const PIN: Record<string, string> = {
      // Q1-A (his own answer, built in HOTFIX-13)
      'ops4.q1.words': 'The owner records the hours worked. Nothing beyond the deposit leaves the renter\'s wallet until she confirms those hours in her own app.',
      // the lead's decision (brief §D): a fact the code proves — pinned by test/ops4a-pages.spec.ts "THE NO-RENTER-APP FACT"
      'ops4.q1.noRenterApp': 'No app for renters to confirm hours exists on this platform yet, so a hire billed above its deposit cannot be settled.',
      // Q2-A (his own answer)
      'ops4.q2.words': 'Hire charges are paid into the wallet of the person who listed this machine — not into the organisation\'s account.',
      // Q3-A (applied from OPS-1 Q2-A)
      'ops4.q3.words': 'Quotes, starting, finishing and payment are done by the machine\'s owner in their own app, not on this console.',
      'ops4.signedIn': 'Signed in as you. These pages show the machines you listed and the hires on them.',
      'ops4.detail.engineHours': 'Engine hours as entered by the owner',
    };
    for (const [k, v] of Object.entries(PIN)) expect([k, en[k]]).toEqual([k, v]);
    for (const k of Object.keys(PIN)) for (const cat of [hi, gu]) expect([k, typeof cat[k] === 'string' && cat[k] !== en[k]]).toEqual([k, true]);
    // Q2's "not into the organisation's account", in every language (a mutant drops it from one)
    expect([/not into the organisation's account/.test(en['ops4.q2.words']), /संगठन के खाते में नहीं/.test(hi['ops4.q2.words']), /સંસ્થાના ખાતામાં નહીં/.test(gu['ops4.q2.words'])]).toEqual([true, true, true]);
    // the no-renter-app fact, in every language (a mutant drops it from one)
    expect([/कोई ऐप अभी नहीं/.test(hi['ops4.q1.noRenterApp']), /કોઈ ઍપ હજી નથી/.test(gu['ops4.q1.noRenterApp'])]).toEqual([true, true]);
    // Q1's "until she confirms" and Q3's "not on this console", in hi / gu
    expect([/पुष्टि नहीं करती/.test(hi['ops4.q1.words']), /પુષ્ટિ ન કરે/.test(gu['ops4.q1.words'])]).toEqual([true, true]);
    expect([/इस कंसोल पर नहीं/.test(hi['ops4.q3.words']), /આ કન્સોલ પર નહીં/.test(gu['ops4.q3.words'])]).toEqual([true, true]);
    // no role claim (OPS-3 Q14-A): no value names a manager, operator or technician affirmatively — the guard above — and no "MM"
    for (const [k, v] of scoped4(en)) expect([k, /\bMM\b/.test(v)]).toEqual([k, false]);
  });
  it('brand guard over every 4a source and fixture', () => {
    for (const rel of SOURCES_4A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_4A) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});

// ── PC-56 OPS-4b (brief §E "Registry, guards, rest"): THE RECORDS guards — the animals and upkeep regexes, each proven on its OWN canon phrase
// (W394–W396, W408 and their chains; persons, places and figures anonymised) and narrowed to the affirmative (a sentence that carries a negation
// passes, the canon's claim is caught; each proven to let its negated form through) — then run over every `ops4.` value and the hire nav labels
// (Maintenance among them) in en, hi and gu. The `%` guard is PLAIN. Then the founder's words (Q4-A's first sentence, Q5-A ×2) are PINNED verbatim
// in English and by their key words in hi / gu; Q4-A's second sentence is pinned ABSENT (its premise is false at merge); and the brand guard
// (survey F-16) runs over every 4b source and fixture.
const NAV_4B = [...NAV_4A, 'nav.chcMaintenance'];
const scoped4b = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('ops4.') || NAV_4B.includes(k));
const GUARDS_4B: ReadonlyArray<[name: string, hit: (v: string) => boolean, canon: string, negated?: string]> = [
  // animals
  ['scan(ned)?', affirmative3(/\bscan(ned)?\b/i), 'Scanned · Pashu-Aadhaar [n] (12-digit INAPH) — [owner]\'s buffalo', 'No tag is scanned here.'],
  ['paravet', affirmative3(/paravet/i), 'Tag application · Applied by a licensed paravet (vet canon record)', 'No paravet applies a tag.'],
  ['photo', affirmative3(/photo/i), 'Photos MUST show the tag in the ear — the same photo standard the insurance desk trusts', 'No photo is taken.'],
  ['INAPH', affirmative3(/INAPH/), 'captured once, straight into the INAPH-linked record', 'This platform is not linked to INAPH.'],
  ['merge desk', affirmative3(/merge desk/i), 'Duplicate tag — routed to the merge desk', 'There is no merge desk.'],
  ['handshake', affirmative3(/handshake/i), 'ownership is real from the handshake', 'No handshake changes an owner.'],
  ['insurance follows', affirmative3(/insurance follows/i), 'Insurance follows ownership — a policy tied to [seller] prompts a re-assignment here', 'It is not true that insurance follows ownership here.'],
  // upkeep
  ['days down', affirmative3(/days? down/i), '[machine] · breakdown · ₹[n] repair · 9 days down', 'No count of days down is shown.'],
  ['real rent', affirmative3(/real rent/i), 'Downtime is the real rent', 'There is no real rent figure.'],
  // the canon's own line carries "haven't", so it is proven on its affirmative fragment (as 4a's guard is): the claim that an odometer step syncs
  ['odometer', affirmative3(/odometer/i), 'next-service list stale — engine-hours sync from a booking\'s odometer step', 'No odometer is read.'],
  ['technician', affirmative3(/technician/i), 'only the maintenance technician can log its completion', 'There is no technician role.'],
  ['completion', affirmative3(/completion|completed_at/i), 'Log completion', 'There is no completion to log.'],
  ['% (plain)', plain(/%/), 'Preventive vs breakdown — 71% … 29%'],
];
const SOURCES_4B = ['components/ops4/UpkeepViews.tsx', 'components/ops4/AnimalViews.tsx', 'components/ops4/AnimalLinks.tsx', 'features/ops4/upkeep.ts', 'app/chc/maintenance/page.tsx',
  'app/chc/maintenance/actions.ts', 'app/animals/eartag-scan/page.tsx', 'app/animals/register/page.tsx', 'app/animals/transfer/page.tsx', 'test-render/ops4b-fixtures.ts'];

describe('PC-56 OPS-4b · the claims guard (ops4. scope, upkeep and animals)', () => {
  it('each guard is proven on its own canon phrase and lets its negated form through', () => {
    for (const [name, hit, canon, negated] of GUARDS_4B) {
      expect([name, hit(canon)]).toEqual([name, true]);
      if (negated) expect([name, 'negated', hit(negated)]).toEqual([name, 'negated', false]);
    }
  });
  it.each(Object.entries(CATS))('%s: no ops4. value (or hire nav label) trips a 4b guard, a 4a guard or a brand regex', (_lang, cat) => {
    expect(scoped4b(cat).length).toBe(268);
    for (const [k, v] of scoped4b(cat)) {
      for (const [name, hit] of [...GUARDS_4B, ...GUARDS_4A]) expect([k, name, hit(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND_4A) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the founder\'s words (Q4-A first sentence, Q5-A ×2) PINNED verbatim (en) and by their key words in hi / gu; Q4-A\'s second sentence ABSENT', () => {
    const PIN: Record<string, string> = {
      'ops4.q4.words': 'This desk does not look up animals by tag.',
      'ops4.q5.register': 'An animal is registered by its owner in her own app. This desk does not register animals.',
      'ops4.q5.transfer': 'Ownership transfer is not available on this platform yet. Nothing here changes who owns an animal.',
      'ops4.upkeep.ownerOnly': 'Only the machine\'s owner records its maintenance. Each entry is recorded.',
      'ops4.upkeep.notOffHire': 'A maintenance entry does not take a machine off hire: it does not change the machine\'s status.',
      'ops4.upkeep.asTyped': 'Recorded by you, as typed — not a measurement.',
      'ops4.upkeep.record': 'Record a maintenance entry',
    };
    for (const [k, v] of Object.entries(PIN)) expect([k, en[k]]).toEqual([k, v]);
    for (const k of Object.keys(PIN)) for (const cat of [hi, gu]) expect([k, typeof cat[k] === 'string' && cat[k] !== en[k]]).toEqual([k, true]);
    // Q4's sentence in every language (a mutant drops it from one)
    expect([/टैग से पशुओं को नहीं खोजता/.test(hi['ops4.q4.words']), /ટૅગથી પશુઓ શોધતું નથી/.test(gu['ops4.q4.words'])]).toEqual([true, true]);
    // Q5's two sentences: "does not register" / "not available … yet", in hi / gu
    expect([/पंजीकरण नहीं करता/.test(hi['ops4.q5.register']), /નોંધણી કરતું નથી/.test(gu['ops4.q5.register'])]).toEqual([true, true]);
    expect([/अभी इस प्लेटफ़ॉर्म पर उपलब्ध नहीं/.test(hi['ops4.q5.transfer']), /હજી આ પ્લેટફોર્મ પર ઉપલબ્ધ નથી/.test(gu['ops4.q5.transfer'])]).toEqual([true, true]);
    // the second Q4 sentence is NOT printed (premise false: her app shows the last four digits of a tag — test/ops4b-pages.spec.ts)
    for (const cat of [en, hi, gu]) for (const v of Object.values(cat)) expect(/sees her animals and their tags/i.test(v)).toBe(false);
    // "Record a maintenance entry" — never "Log completion"
    for (const [k, v] of scoped4b(en)) expect([k, /log completion/i.test(v) && !NEG3.test(v)]).toEqual([k, false]);
  });
  it('brand guard over every 4b source and fixture (no F-16 literal: "Jashoda", "Jaffarabadi", "8802", "ORD-0713", "₹18,400", "9 days" …)', () => {
    const MORE: ReadonlyArray<RegExp> = [/\b8802\b/, /ORD-0713/, /18,400/, /\b9 days\b/, /Kisan Mitra/i, /Kiran Ben/i];
    for (const rel of SOURCES_4B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND_4A) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
      for (const re of MORE) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});
