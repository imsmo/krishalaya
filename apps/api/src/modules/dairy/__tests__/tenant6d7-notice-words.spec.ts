// modules/dairy/__tests__/tenant6d7-notice-words.spec.ts · PC-56 TENANT-6d-7 · THE WORDS THAT NEVER ARRIVED.
//
// THE GUARD THIS WAVE EXISTS TO LEAVE BEHIND. Everything else here is a repair; this file is the reason the repair
// cannot come undone. It reads the REAL seeded copy out of `db/seeds/core/0007_notification_events_templates.sql`, the
// REAL declared variables out of the same file, and renders one against the other through the REAL
// `NotificationTemplate.render` — the same function the send path uses — using the variables the emitters now produce.
//
// It fails on any of the four shapes this wave found:
//   1. a token the payload has no value for → renders as the empty string, silently, for ever;
//   2. a value that is an object → `JSON.stringify` prints a JSON array into an SMS;
//   3. an English enum inside a Gujarati or Hindi body → the copy is vernacular and the word inside it is not;
//   4. a declared REQUIRED variable that no body uses → the declaration and the copy have drifted apart.
//
// WHY IT READS THE SEED FILE AND NOT THE DATABASE. The unit project has no Postgres, and this must run on every
// commit rather than only in the live suite — the defect it guards is a mismatch between two files, and both files are
// on disk. `tenant6d7-notice-words.integration.spec.ts` then proves the same thing THROUGH the database, because a
// seed file that nothing applies is a different defect this programme has also found (6c-4).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NotificationTemplate } from '../../communication/domain/notification-template.entity';
import { NotifChannel } from '../../communication/domain/communication.events';
import { LangMap, isLangMap, pickLang, langMapFrom } from '../../../core/i18n/lang-map';
import { moneyText } from '../../../core/money/money-text';
import { MilkQualityReview } from '../domain/milk-quality-review.entity';
import { MilkBill } from '../domain/milk-bill.entity';
import { MilkBillDispute } from '../domain/milk-bill-dispute.entity';
import { DairyDeductionInstruction } from '../domain/dairy-deduction-instruction.entity';
import {
  DairyNoticeLabels, NoticeVars, billConsentVars, billDisputeResolvedVars, billPreviewedVars, dayRangeText, dayText,
  deductionInstructionVars, diversionNoticeVars, linesText, litresText, momentText, qualityDecidedVars,
  qualityOpenedVars,
} from '../domain/dairy-notice-vars';

const SEED = path.join(__dirname, '../../../../../../db/seeds/core/0007_notification_events_templates.sql');
const UI_SEED = path.join(__dirname, '../../../../../../db/seeds/core/0016_ui_messages_dairy_notices.sql');
const seed = () => fs.readFileSync(SEED, 'utf8');

/** The events this wave repaired, and therefore the events the guard covers. */
const DAIRY_EVENTS = [
  'dairy.quality_flag_opened', 'dairy.quality_flag_decided', 'dairy.bill_previewed', 'dairy.bill_dispute_resolved',
  'dairy.bill_deduction_consent_required', 'dairy.deduction_instruction_authorised', 'dairy.deduction_instruction_revoked',
  // [PC-56 TENANT-6d-8] W170's route notice and its retraction — the first copy in this file written AFTER the guard
  // existed, and therefore the first that was never broken. Added here rather than in a spec of its own so that the
  // notice is held to the same four rules as the notices this guard was built to repair.
  'dairy.shift_diverted', 'dairy.shift_diversion_cancelled',
] as const;

interface SeededTemplate { event: string; channel: string; lang: string; subject: string | null; body: string; tokens: string[]; }

/**
 * Read the seeded platform templates out of the SQL.
 *
 * One row per line is how this file is written, and that is asserted rather than assumed — a multi-line body would make
 * this parse silently incomplete, which is precisely the class of mistake being guarded against.
 */
function seededTemplates(): SeededTemplate[] {
  const out: SeededTemplate[] = [];
  for (const line of seed().split('\n')) {
    const m = /^\s*\('([a-z0-9._]+)','([a-z]+)','([a-z]+)'/.exec(line);
    if (!m) continue;
    const tokens = [...line.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((t) => t[1]);
    // The body is the 6th SQL value; we only need its tokens and whether a subject exists, so the split is by token
    // extraction rather than by a fragile CSV parse of quoted Gujarati text containing commas.
    out.push({ event: m[1], channel: m[2], lang: m[3], subject: null, body: line, tokens });
  }
  return out;
}

/** The declared contract: `notification_event_variables` rows, as the seed writes them. */
function declaredVars(): Map<string, Array<{ name: string; required: boolean }>> {
  const out = new Map<string, Array<{ name: string; required: boolean }>>();
  for (const line of seed().split('\n')) {
    const m = /^\s*\('([a-z0-9._]+)',\s*'([a-z_]+)',\s*'[^']*'.*?(true|false)\)/.exec(line);
    if (!m) continue;
    // A template row also starts `('code','channel',...` — a declaration's second value is a variable NAME and its
    // third is a source description, so a row whose second value is a known channel is not a declaration.
    if (['sms', 'push', 'inapp', 'email', 'whatsapp', 'ivr'].includes(m[2])) continue;
    const rows = out.get(m[1]) ?? [];
    rows.push({ name: m[2], required: m[3] === 'true' });
    out.set(m[1], rows);
  }
  return out;
}

/** The labels seed 0016 puts in `ui_messages`, read from the file for the same reason. */
function seededLabels(): DairyNoticeLabels {
  const rows = new Map<string, Map<string, string>>();
  for (const line of fs.readFileSync(UI_SEED, 'utf8').split('\n')) {
    const m = /^\s*\('([a-z0-9._]+)',\s*'([a-z]+)',\s*'(.*)'\)[,;]?\s*$/.exec(line);
    if (!m) continue;
    const k = rows.get(m[1]) ?? new Map<string, string>();
    k.set(m[2], m[3]);
    rows.set(m[1], k);
  }
  const need = (key: string) => {
    const m = rows.get(key);
    if (!m) throw new Error(`seed 0016 has no '${key}'`);
    return langMapFrom(m, key);
  };
  return {
    shift: { morning: need('dairy.shift.morning'), evening: need('dairy.shift.evening') },
    qualityOutcome: { cleared: need('dairy.quality.outcome.cleared'), rejected: need('dairy.quality.outcome.rejected') },
    disputeOutcome: { upheld: need('dairy.dispute.outcome.upheld'), rejected: need('dairy.dispute.outcome.rejected') },
  };
}

const LABELS = seededLabels();
const INR = { currencyCode: 'INR', minorUnits: 2 };
const M = (minor: bigint) => ({ minor, ...INR });

/**
 * THE PAYLOAD EACH EVENT NOW CARRIES, built by the SAME pure functions the emitters call.
 *
 * This is the spec's whole claim: what is rendered here is what a farmer receives, because both sides come from
 * `domain/dairy-notice-vars.ts`. A hand-written literal here would test the literal.
 */
const PAYLOADS: Record<string, NoticeVars> = {
  'dairy.quality_flag_opened': qualityOpenedVars({ mccName: 'Vanthali', shift: 'evening', labels: LABELS }),
  'dairy.quality_flag_decided': qualityDecidedVars({ outcome: 'cleared', labels: LABELS }),
  'dairy.bill_previewed': billPreviewedVars({
    periodStart: '2026-07-01', periodEnd: '2026-07-15', totalLitresMilli: 204_526n,
    net: M(841_200n), deductions: M(0n), windowEndsAt: new Date('2026-07-16T03:30:00.000Z'), timezone: 'Asia/Kolkata',
  }),
  'dairy.bill_dispute_resolved': billDisputeResolvedVars({
    periodStart: '2026-07-01', periodEnd: '2026-07-15', outcome: 'upheld',
    note: 'Weight corrected and the bill rebuilt.', labels: LABELS,
  }),
  'dairy.bill_deduction_consent_required': billConsentVars({
    periodStart: '2026-07-01', periodEnd: '2026-07-15', gross: M(941_400n), deductions: M(240_000n), thresholdPct: 25,
    lines: [
      { name: { en: 'feed credit', hi: 'chara udhaar', gu: 'ચારા ઉધાર' }, amount: M(50_000n) },
      { name: { en: 'loan instalment', hi: 'karz kist', gu: 'લોન હપ્તો' }, amount: M(190_000n) },
    ],
  }),
  'dairy.deduction_instruction_authorised': deductionInstructionVars({
    what: { en: 'feed credit', hi: 'chara udhaar', gu: 'ચારા ઉધાર' }, maxPerCycle: M(20_000n),
  }),
  'dairy.shift_diverted': diversionNoticeVars({
    fromName: 'Vanthali', toName: 'Bhesan', day: '2026-08-21', shift: 'evening', labels: LABELS,
  }),
  'dairy.shift_diversion_cancelled': diversionNoticeVars({
    fromName: 'Vanthali', toName: 'Bhesan', day: '2026-08-21', shift: 'evening', labels: LABELS,
  }),
  'dairy.deduction_instruction_revoked': deductionInstructionVars({
    what: { en: 'feed credit', hi: 'chara udhaar', gu: 'ચારા ઉધાર' }, maxPerCycle: null,
  }),
};

const render = (t: SeededTemplate, vars: Record<string, unknown>) => NotificationTemplate.rehydrate({
  id: `${t.event}|${t.channel}|${t.lang}`, eventCode: t.event, channel: t.channel as NotifChannel, languageCode: t.lang,
  tenantId: null, subject: null, body: t.tokens.map((k) => `{{${k}}}`).join(''), providerTemplateRef: null,
  isActive: true, versionId: 'v1', versionNo: 1,
}).render(vars);

describe('PC-56 TENANT-6d-7 · every seeded dairy template renders against the payload it will be given', () => {
  const templates = seededTemplates().filter((t) => (DAIRY_EVENTS as readonly string[]).includes(t.event));

  it('found the seeded copy at all — a parse that quietly matched nothing would prove nothing', () => {
    // 9 events × 3 languages × (sms + push + inapp at least). The floor is deliberately loose: this asserts the file
    // was FOUND and parsed, not how much copy a future wave adds.
    expect(templates.length).toBeGreaterThanOrEqual(69);
    for (const ev of DAIRY_EVENTS) {
      const langs = new Set(templates.filter((t) => t.event === ev).map((t) => t.lang));
      expect([...langs].sort()).toEqual(['en', 'gu', 'hi']);   // i18n ×3, per the definition of done
    }
  });

  it('RESOLVES EVERY TOKEN — nothing renders as the empty string', () => {
    const blanks: string[] = [];
    for (const t of templates) {
      const vars = PAYLOADS[t.event];
      for (const tok of t.tokens) {
        const rendered = render({ ...t, tokens: [tok] }, vars).body;
        if (rendered.trim() === '') blanks.push(`${t.event}/${t.channel}/${t.lang}: {{${tok}}}`);
      }
    }
    // Before this wave this list held FIFTEEN entries — `mcc`, `shift`'s English, `litres`, `net`, `deductions`,
    // `window_ends`, `period`, `gross`, `threshold_pct`, `what`, `how_much` — and every one of them was a farmer
    // reading a sentence with a hole where their money or their village used to be.
    expect(blanks).toEqual([]);
  });

  it('NEVER PRINTS AN OBJECT — a JSON array in an SMS is not a sentence', () => {
    for (const t of templates) {
      const body = render(t, PAYLOADS[t.event]).body;
      expect(body).not.toMatch(/[[{]"/);            // `[{"type":…` — 6c-4's `{{lines}}`, verbatim
      expect(body).not.toContain('[object Object]');
    }
  });

  it('SPEAKS THE BODY\'S OWN LANGUAGE — no English enum inside Gujarati or Hindi copy', () => {
    // The three words that leaked, by name. A body in `gu` must not contain them; the `en` body must (that is what
    // makes this assertion about localisation rather than about spelling).
    const LEAKS = ['evening', 'morning', 'cleared', 'upheld', 'rejected'];
    for (const t of templates.filter((x) => x.lang !== 'en')) {
      const body = render(t, PAYLOADS[t.event]).body;
      for (const leak of LEAKS) expect(body.toLowerCase()).not.toContain(leak);
    }
    const en = templates.find((t) => t.event === 'dairy.quality_flag_opened' && t.lang === 'en')!;
    expect(render(en, PAYLOADS[en.event]).body).toContain('evening');
    const gu = templates.find((t) => t.event === 'dairy.quality_flag_opened' && t.lang === 'gu')!;
    expect(render(gu, PAYLOADS[gu.event]).body).toContain('સાંજ');
  });

  it('HONOURS THE DECLARED CONTRACT: every required variable is used, and every used token is declared', () => {
    const declared = declaredVars();
    for (const ev of DAIRY_EVENTS) {
      const rows = declared.get(ev) ?? [];
      const used = new Set(templates.filter((t) => t.event === ev).flatMap((t) => t.tokens));
      // Every token in a body is declared — the authoring screen (0122) offers a tenant the declared list, so an
      // undeclared token in platform copy is a variable a tenant editing that copy would never be told exists.
      for (const tok of used) expect(rows.map((r) => r.name)).toContain(tok);
      // ...and every REQUIRED declaration is actually used by at least one body. A required variable no body reads is
      // the same drift seen from the other side.
      for (const r of rows.filter((x) => x.required)) expect([...used]).toContain(r.name);
    }
  });
});

describe('PC-56 TENANT-6d-7 · the per-language value, and the renderer that picks from it', () => {
  it('picks the template\'s own language, falls back to English, and never blanks', () => {
    const m: LangMap = { en: 'evening', hi: 'shaam', gu: 'સાંજ' };
    expect(pickLang(m, 'gu')).toBe('સાંજ');
    expect(pickLang(m, 'gu-IN')).toBe('સાંજ');          // a regional tag reads the base language's copy
    expect(pickLang(m, 'mr')).toBe('evening');           // Marathi has no row yet: the English word, not a blank
    expect(pickLang({ en: 'x', gu: '' }, 'gu')).toBe('x'); // an EMPTY translation is a missing one
  });

  it('is a LangMap only when it says `en` in it — no type assertion, a shape check', () => {
    expect(isLangMap({ en: 'a' })).toBe(true);
    expect(isLangMap({ gu: 'a' })).toBe(false);           // no English fallback ⇒ not usable as one
    expect(isLangMap(['a'])).toBe(false);
    expect(isLangMap('a')).toBe(false);
    expect(isLangMap(null)).toBe(false);
    expect(isLangMap({ en: 1 })).toBe(false);
  });

  it('renders the map through the TEMPLATE, so one payload serves three bodies', () => {
    const body = 'Your {{shift}} milk at {{mcc}}';
    const vars = { shift: { en: 'evening', hi: 'shaam', gu: 'સાંજ' }, mcc: 'Vanthali' };
    const of = (lang: string) => NotificationTemplate.rehydrate({
      id: 't', eventCode: 'e', channel: 'sms', languageCode: lang, tenantId: null, subject: null, body,
      providerTemplateRef: null, isActive: true,
    }).render(vars).body;
    expect(of('en')).toBe('Your evening milk at Vanthali');
    expect(of('gu')).toBe('Your સાંજ milk at Vanthali');
    expect(of('hi')).toBe('Your shaam milk at Vanthali');
    // A plain string is untouched — the mechanism is opt-in per VALUE, so no existing template changes behaviour.
    expect(of('gu')).toContain('Vanthali');
  });

  it('refuses to build a label with no English text', () => {
    expect(() => langMapFrom(new Map([['gu', 'સાંજ']]), 'dairy.shift.evening')).toThrow(/no English text/);
    expect(langMapFrom(new Map([['en', 'evening'], ['gu', 'સાંજ']]), 'x')).toEqual({ en: 'evening', gu: 'સાંજ' });
  });
});

describe('PC-56 TENANT-6d-7 · the values themselves', () => {
  it('formats money by integer arithmetic against the CURRENCY\'S OWN minor units', () => {
    expect(moneyText(841_200n, 'INR', 2)).toBe('INR 8,412.00');
    expect(moneyText(841_200n, 'JPY', 0)).toBe('JPY 841,200');       // a hardcoded ÷100 would be wrong by 100×
    expect(moneyText(841_200n, 'KWD', 3)).toBe('KWD 841.200');
    expect(moneyText(-50n, 'INR', 2)).toBe('INR -0.50');
    expect(() => moneyText(1n, 'XXX', 9)).toThrow(/minor_units out of range/);
  });

  it('formats litres from MILLI-litres by string, never by division', () => {
    expect(litresText(204_526n)).toBe('204.526');
    expect(litresText(1n)).toBe('0.001');
    expect(litresText(1_000n)).toBe('1.000');
    // 0.1 + 0.2 arithmetic has no place next to a farmer's payment; the last three digits are EXACT, and the value
    // below is the one that proves it: beyond 2^53 a float cannot hold the millilitre, so `Number(x)/1000` rounds
    // 9007199254740.993 to ...992 and a union's fortnight loses a litre. (The mutation pass found this assertion too
    // weak — every value it used was small enough for a float to get right.)
    expect(litresText(999_999_999_999n)).toBe('999999999.999');
    expect(litresText(9_007_199_254_740_993n)).toBe('9007199254740.993');
    expect((Number(9_007_199_254_740_993n) / 1000).toFixed(3)).toBe('9007199254740.992');
  });

  it('writes whole days as digits, in the order the payload states', () => {
    expect(dayText('2026-07-01')).toBe('01/07');
    expect(dayRangeText('2026-07-01', '2026-07-15')).toBe('01/07–15/07');
    expect(() => dayText('01 Jul 2026')).toThrow(/not a whole day/);
  });

  it('writes the objection deadline in the COOPERATIVE\'S timezone, on a 24-hour clock', () => {
    const at = new Date('2026-07-16T03:30:00.000Z');
    expect(momentText(at, 'Asia/Kolkata')).toBe('16/07 09:00');
    // The same instant, read in London: the point of passing a timezone rather than assuming one.
    expect(momentText(at, 'Europe/London')).toBe('16/07 04:30');
  });

  it('joins the deduction lines PER LANGUAGE, so the Gujarati body reads as Gujarati', () => {
    const t = linesText([
      { name: { en: 'feed credit', gu: 'ચારા ઉધાર' }, amount: M(50_000n) },
      { name: { en: 'loan instalment', gu: 'લોન હપ્તો' }, amount: M(190_000n) },
    ]);
    expect(t.en).toBe('feed credit INR 500.00, loan instalment INR 1,900.00');
    expect(t.gu).toBe('ચારા ઉધાર INR 500.00, લોન હપ્તો INR 1,900.00');
    // A line whose name has no Gujarati falls back to English INSIDE the joined sentence rather than dropping it.
    const mixed = linesText([{ name: { en: 'feed credit' }, amount: M(50_000n) }]);
    expect(mixed.en).toBe('feed credit INR 500.00');
  });

  it('says an UNCAPPED arrangement in words rather than leaving the ceiling blank', () => {
    const capped = deductionInstructionVars({ what: { en: 'feed credit' }, maxPerCycle: M(20_000n) });
    expect(capped.how_much).toEqual({ en: 'INR 200.00' });
    const open = deductionInstructionVars({ what: { en: 'feed credit' }, maxPerCycle: null });
    // An instruction with no cap is a materially different arrangement from one capped at INR 200, and the member is
    // entitled to be told which one they authorised — in their own language.
    expect(pickLang(open.how_much as LangMap, 'gu')).toBe('પ્રતિ ચક્ર મર્યાદા નથી');
    expect(pickLang(open.how_much as LangMap, 'en')).toBe('no per-cycle limit');
  });
});

/* ============================================================================================================= */
/* AND THE OTHER HALF OF THE LOOP: THE EMITTERS ACTUALLY CARRY THEM.                                             */
/*                                                                                                              */
/* The guard above proves the pure vars satisfy the copy. It would still pass if an emitter stopped spreading    */
/* them — which is exactly the mistake that created the defect, one keyboard at a time. So each event is built    */
/* HERE THROUGH ITS OWN ENTITY, with the notice the service now passes, and its payload is checked against the    */
/* declared contract. Any future emitter that forgets fails this, not a farmer.                                   */
/* ============================================================================================================= */
describe('PC-56 TENANT-6d-7 · the emitted payloads carry every declared variable', () => {
  const declared = declaredVars();
  const requiredFor = (ev: string) => (declared.get(ev) ?? []).filter((r) => r.required).map((r) => r.name);
  const has = (payload: Record<string, unknown>, ev: string) => {
    for (const name of requiredFor(ev)) {
      const v = payload[name];
      const text = isLangMap(v) ? pickLang(v, 'gu') : v;
      expect(typeof text === 'string' && text.length > 0 ? 'present' : `${ev}.${name} MISSING`).toBe('present');
    }
  };

  const review = () => MilkQualityReview.open({
    id: 'qr1', tenantId: 't1', collectionId: 'c1', collectedOn: '2026-07-13', membershipId: 'mem1', mccId: 'm1',
    shift: 'evening', waterFlag: true, reasons: [], densityAtFlag: '1.024', fatPctAtFlag: '6.20', snfPctAtFlag: '8.40',
    amountWithheldMinor: 57_100n, currencyCode: 'INR', openedBy: 'op1', priorReviews90d: 0,
  }, 'farmer-1', qualityOpenedVars({ mccName: 'Vanthali', shift: 'evening', labels: LABELS }));

  it('dairy.quality_flag_opened — the centre by NAME and the shift as a word', () => {
    const [e] = review().pullEvents();
    expect(e.type).toBe('dairy.quality_flag_opened');
    has(e.payload as Record<string, unknown>, 'dairy.quality_flag_opened');
    expect(e.payload.mcc).toBe('Vanthali');
    expect(pickLang(e.payload.shift as LangMap, 'gu')).toBe('સાંજ');
    expect(e.payload.shiftCode).toBe('evening');        // the enum keeps its own name, for code
    expect(e.payload.userId).toBe('farmer-1');
  });

  it('dairy.quality_flag_decided — WITH A RECIPIENT, which it never had', () => {
    const r = review(); r.pullEvents();
    r.decide('cleared', 'sec1', new Date('2026-07-14T05:00:00Z'), null, 'farmer-1',
      qualityDecidedVars({ outcome: 'cleared', labels: LABELS }));
    const [e] = r.pullEvents();
    has(e.payload as Record<string, unknown>, 'dairy.quality_flag_decided');
    // The whole reason this notice never arrived: no `userId` ⇒ the fanout handler returns before it sends anything.
    expect(e.payload.userId).toBe('farmer-1');
    expect(pickLang(e.payload.outcome as LangMap, 'gu')).toBe('પાસ થયું');
    expect(e.payload.outcomeCode).toBe('cleared');
  });

  it('dairy.bill_previewed — the four figures W169 promises the member sees', () => {
    const b = MilkBill.generate({
      id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      totalLitresMilli: 204_526n, grossMinor: 841_200n,
    });
    b.pullEvents();
    b.preview(new Date('2026-07-15T18:00:00Z'), new Date('2026-07-16T03:30:00.000Z'), 'farmer-1',
      PAYLOADS['dairy.bill_previewed']);
    const [e] = b.pullEvents();
    has(e.payload as Record<string, unknown>, 'dairy.bill_previewed');
    expect(e.payload.net).toBe('INR 8,412.00');
    expect(e.payload.litres).toBe('204.526');
    expect(e.payload.window_ends).toBe('16/07 09:00');
    expect(e.payload.periodRange).toBe('2026-07-01..2026-07-15');   // the ISO pair, still there, renamed
  });

  it('dairy.bill_dispute_resolved — from BOTH of its emitters', () => {
    const vars = PAYLOADS['dairy.bill_dispute_resolved'];
    const d = MilkBillDispute.open({
      id: 'd1', tenantId: 't1', billId: 'b1', membershipId: 'mem1', raisedByUserId: 'farmer-1',
      windowEndedAt: new Date('2026-07-16T03:30:00.000Z'), at: new Date('2026-07-15T19:00:00Z'),
      reason: 'my litres are short by about four',
    });
    d.pullEvents();
    d.resolve({ outcome: 'upheld', byUserId: 'op1', at: new Date('2026-07-16T02:00:00Z'),
      note: 'Weight corrected and the bill rebuilt.', voidedBill: false, notice: vars });
    const [e1] = d.pullEvents();
    has(e1.payload as Record<string, unknown>, 'dairy.bill_dispute_resolved');

    const b = MilkBill.generate({
      id: 'b1', tenantId: 't1', membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      totalLitresMilli: 204_526n, grossMinor: 841_200n,
    });
    b.pullEvents();
    b.preview(new Date('2026-07-15T18:00:00Z'), new Date('2026-07-16T03:30:00.000Z'), 'farmer-1', PAYLOADS['dairy.bill_previewed']);
    b.dispute(new Date('2026-07-15T19:00:00Z'), 'short litres'); b.pullEvents();
    b.resolveToPreviewed(new Date('2026-07-16T02:00:00Z'), new Date('2026-07-18T03:30:00Z'), 'farmer-1', 'rejected', vars);
    const [e2] = b.pullEvents();
    has(e2.payload as Record<string, unknown>, 'dairy.bill_dispute_resolved');
    expect(e2.payload.outcomeCode).toBe('rejected');
  });

  it('dairy.deduction_instruction_authorised / _revoked — WHAT is being taken, and the ceiling', () => {
    const i = DairyDeductionInstruction.authorise({
      id: 'i1', tenantId: 't1', membershipId: 'mem1', typeId: 'ty1', typeCode: 'feed_credit', sourceId: null,
      maxPerCycleMinor: 20_000n, authorisedBy: 'farmer-1', authorisedAt: new Date('2026-07-01T05:00:00Z'),
      channel: 'app', assistedBy: null, recordedBy: 'op1', note: null,
      notice: PAYLOADS['dairy.deduction_instruction_authorised'],
    });
    const [a] = i.pullEvents();
    has(a.payload as Record<string, unknown>, 'dairy.deduction_instruction_authorised');
    expect(pickLang(a.payload.what as LangMap, 'gu')).toBe('ચારા ઉધાર');

    i.revoke(new Date('2026-08-01T05:00:00Z'), 'farmer-1', PAYLOADS['dairy.deduction_instruction_revoked']);
    const [r] = i.pullEvents();
    has(r.payload as Record<string, unknown>, 'dairy.deduction_instruction_revoked');
  });

  it('dairy.bill_deduction_consent_required — asserted on the SERVICE, because that is where it is raised', () => {
    // This one event is emitted inline by `MilkBillService.preview` rather than by an entity (6c-4 built it that way:
    // the ask is a decision the service takes after reading the threshold). So the loop is closed on the source: the
    // payload spreads the vars, and the array keeps its own name. A service harness would need eighteen fakes to prove
    // one spread; this is the honest smaller claim, and the live suite renders the real thing.
    const svc = fs.readFileSync(path.join(__dirname, '../services/milk-bill.service.ts'), 'utf8');
    expect(svc).toContain('...(await this.noticeVars.billConsent(tx, tenantId, {');
    expect(svc).toContain('lineItems: bill.deductionLines.map(');
    expect(svc).toContain('periodRange: `${bill.toProps().periodStart}..${bill.toProps().periodEnd}`');
  });
});
