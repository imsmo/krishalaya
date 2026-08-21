// modules/dairy/domain/dairy-notice-vars.ts · PC-56 TENANT-6d-7 · THE WORDS THAT NEVER ARRIVED. PURE.
//
// ==================================================================================================================
// THE FINDING, AND IT IS NOT SUBTLE ONCE THE TWO SIDES ARE PUT SIDE BY SIDE.
// ==================================================================================================================
//
// Every dairy member notice on this platform was built in three careful halves by three careful waves:
//
//   • `db/seeds/core/0007` seeds the COPY, three languages per channel, with DLT notes and a version row each;
//   • the same file DECLARES each event's variables in `notification_event_variables` — name, source, sample,
//     `is_required = true` — which is 0122's own mechanism for *"a required variable missing from a body is refused"*;
//   • the domain entity emits the PAYLOAD the copy will be rendered against.
//
// **NOTHING HAS EVER COMPARED THE SECOND HALF WITH THE THIRD.** The declarations were written from the screen's point
// of view (`mcc`, `shift`, `net`, `gross`, `what`, `how_much`) and the payloads were written from the domain's
// (`mccId`, `shift` as the raw enum, `netMinor`, `grossMinor`, `typeCode`, `maxPerCycleMinor`). `render()` replaces an
// unknown token with the EMPTY STRING — deliberately, so a farmer never sees `{{x}}` — so every mismatch is silent by
// design. What the platform actually sent, verified token by token against each emitter:
//
//   dairy.quality_flag_opened   `{{mcc}}` → ''  ·  `{{shift}}` → 'evening' inside the Gujarati body
//   dairy.quality_flag_decided  `{{outcome}}` → 'cleared' inside the Gujarati body — AND THE EVENT CARRIED NO
//                               `userId` AT ALL, so `DomainEventFanoutHandler` found no recipient and returned early:
//                               W168's *"member learns the outcome"* has never sent one message.
//   dairy.bill_previewed        `{{litres}}` `{{net}}` `{{deductions}}` `{{window_ends}}` → all '' (only `period` hit)
//   dairy.bill_dispute_resolved `{{period}}` → ''  ·  `{{outcome}}` → 'upheld' in Gujarati
//   dairy.bill_deduction_consent_required
//                               `{{gross}}` `{{deductions}}` `{{threshold_pct}}` → ''  ·  `{{lines}}` → a JSON array
//                               printed into an SMS: `[{"type":"feed","amountMinor":"240000"}]`
//   dairy.deduction_instruction_authorised/revoked
//                               `{{what}}` `{{how_much}}` → ''
//
// So W169's *"Preview goes to every member in Gujarati BEFORE money moves — surprises are for birthdays, not milk
// money"* would have sent a member: *"તમારું બિલ  લિટર,  ચોખ્ખા..."* — a sentence with the numbers cut out of it.
// And it would have sent it in ENGLISH, because `fanout` never read `users.language_code` either (the other half of
// this wave; see `NotificationService.fanout`).
//
// ==================================================================================================================
// WHY THIS FILE EXISTS, AND WHY IT IS PURE.
// ==================================================================================================================
//
// The mismatch happened because the payload was assembled at six different keyboards, each next to the entity whose
// props were in scope. So ONE file now owns "what a dairy notice's variables are", it is pure (money is formatted by
// integer arithmetic, labels arrive as per-language maps read from the database, nothing here knows a language or a
// currency by heart), and `__tests__/tenant6d7-notice-words.spec.ts` renders the REAL seeded copy against the output
// of these functions — so the next mismatch fails a test instead of blanking a farmer's bill.
//
// EVERY VALUE HERE IS DISPLAY-READY, and that is the boundary this wave draws: **a payload is not a projection of the
// domain, it is the argument list of a sentence somebody reads.** The domain keys stay in the payload alongside them
// (a consumer that wants `netMinor` still finds it) — what changes is that the words the copy asks for are there too.
import { LangMap } from '../../../core/i18n/lang-map';
import { moneyText } from '../../../core/money/money-text';
import { MilkShift } from './dairy.events';

/**
 * WHAT AN EMITTER SPREADS INTO ITS PAYLOAD: display-ready values, keyed by the names the COPY uses (not the names the
 * domain uses). A value is either a finished string or a per-language map the renderer picks from.
 */
export type NoticeVars = Record<string, string | LangMap>;

/** The per-language words a dairy notice needs, read from `ui_messages` (seed 0016) by the caller. */
export interface DairyNoticeLabels {
  shift: Record<MilkShift, LangMap>;
  qualityOutcome: Record<'cleared' | 'rejected', LangMap>;
  disputeOutcome: Record<'upheld' | 'rejected', LangMap>;
}

/** What a caller must hand over to format money: the currency and ITS OWN minor units, never a hardcoded 100. */
export interface Money { minor: bigint; currencyCode: string; minorUnits: number; }

export const money = (m: Money): string => moneyText(m.minor, m.currencyCode, m.minorUnits);

/**
 * LITRES FROM MILLI-LITRES, BY STRING. `total_litres_milli` is an integer of thousandths (0009's scaled-integer
 * discipline, the same reason temperatures are deci-degrees), and the declared sample for `{{litres}}` is `204.526`.
 * Division would put a float next to a farmer's payment.
 */
export function litresText(milli: bigint): string {
  const neg = milli < 0n;
  const abs = neg ? -milli : milli;
  const whole = (abs / 1000n).toString();
  const frac = (abs % 1000n).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/**
 * A WHOLE-DAY RANGE IN DIGITS: `01/07–15/07`.
 *
 * The declared sample is `01-15 Jul`, and this deliberately does NOT render a month NAME. A month name is a word, and
 * a word in a notice has to exist in three languages — `ui_messages` holds the twelve months in none of them today, so
 * printing `Jul` inside a Gujarati sentence would be the exact defect this wave is closing, one size smaller. Digits
 * are readable in every script this platform ships and unambiguous in the order the payload states.
 *
 * Days are `YYYY-MM-DD` strings compared and sliced as strings — TENANT-6c-1's ruling on paydays: a `Date` here is a
 * timezone bug with a nice constructor.
 */
export function dayRangeText(fromDay: string, toDay: string): string {
  return `${dayText(fromDay)}–${dayText(toDay)}`;
}
export function dayText(day: string): string {
  const [, m, d] = day.split('-');
  if (!m || !d) throw new Error(`dairy notice: not a whole day: ${day}`);
  return `${d}/${m}`;
}

/**
 * A MOMENT, IN DIGITS AND IN THE TENANT'S OWN TIMEZONE: `15/07 09:00`.
 *
 * The declared sample for `{{window_ends}}` is `Fri 9:00 am` — a weekday name and an am/pm marker, both of which are
 * words. Same argument as above, plus one more: this is the deadline by which a member must object to their own bill,
 * so it is the single value in these notices that must not be even slightly wrong. A 24-hour clock in the timezone the
 * cooperative works in has no ambiguity to be wrong about.
 */
export function momentText(at: Date, timezone: string): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')} ${g('hour')}:${g('minute')}`;
}

/** W168's flag notice: which centre, which collection. */
export function qualityOpenedVars(i: { mccName: string; shift: MilkShift; labels: DairyNoticeLabels }): { mcc: string; shift: LangMap } {
  return { mcc: i.mccName, shift: i.labels.shift[i.shift] };
}

/** W168's decision notice — the one that sent nothing at all, because the event named no recipient. */
export function qualityDecidedVars(i: { outcome: 'cleared' | 'rejected'; labels: DairyNoticeLabels }): { outcome: LangMap } {
  return { outcome: i.labels.qualityOutcome[i.outcome] };
}

/** W169's preview: the figures a member is being asked to accept, and the hour they have to object by. */
export function billPreviewedVars(i: {
  periodStart: string; periodEnd: string; totalLitresMilli: bigint; net: Money; deductions: Money;
  windowEndsAt: Date; timezone: string;
}): { period: string; litres: string; net: string; deductions: string; window_ends: string } {
  return {
    period: dayRangeText(i.periodStart, i.periodEnd),
    litres: litresText(i.totalLitresMilli),
    net: money(i.net),
    deductions: money(i.deductions),
    window_ends: momentText(i.windowEndsAt, i.timezone),
  };
}

/** W169's objection outcome. `note` is the resolver's own words and is passed through verbatim — never summarised. */
export function billDisputeResolvedVars(i: {
  periodStart: string; periodEnd: string; outcome: 'upheld' | 'rejected'; note: string; labels: DairyNoticeLabels;
}): { period: string; outcome: LangMap; note: string } {
  return { period: dayRangeText(i.periodStart, i.periodEnd), outcome: i.labels.disputeOutcome[i.outcome], note: i.note };
}

/**
 * W169's consent request — the only dairy notice that ASKS instead of TELLING, and the one whose `{{lines}}` was a
 * JSON array in an SMS.
 *
 * `lines` is rendered as *"feed credit INR 500.00, loan INR 1,900.00"* from per-line NAMES the caller resolved through
 * the lookup vocabulary (Law 6: the deduction types are `lookup_values`, not an enum in this file) — because
 * *"INR 2,400 was taken"* is not an answer to *"what for?"*, which is 6c-4's own sentence about this very notice.
 */
export function billConsentVars(i: {
  periodStart: string; periodEnd: string; gross: Money; deductions: Money; thresholdPct: number;
  lines: ReadonlyArray<{ name: LangMap; amount: Money }>;
}): { period: string; gross: string; deductions: string; threshold_pct: string; lines: LangMap } {
  return {
    period: dayRangeText(i.periodStart, i.periodEnd),
    gross: money(i.gross),
    deductions: money(i.deductions),
    threshold_pct: String(i.thresholdPct),
    lines: linesText(i.lines),
  };
}

/**
 * The deduction breakdown, ONE STRING PER LANGUAGE — a `LangMap`, because each line's name is one and joining them
 * per language is the only way the Gujarati body reads as Gujarati. An empty list renders as an empty string rather
 * than throwing: a consent request with no lines cannot happen (the gate is a percentage OF the lines), and a notice
 * is not the place to discover that.
 */
export function linesText(lines: ReadonlyArray<{ name: LangMap; amount: Money }>): LangMap {
  const langs = new Set<string>(['en']);
  for (const l of lines) for (const k of Object.keys(l.name)) if (l.name[k]) langs.add(k);
  const out: LangMap = { en: '' };
  for (const lang of langs) {
    out[lang] = lines.map((l) => `${l.name[lang] ?? l.name.en} ${money(l.amount)}`).join(', ');
  }
  return out;
}

/** W169's standing instruction, starting and ending: WHAT is being taken, and the ceiling per cycle. */
export function deductionInstructionVars(i: { what: LangMap; maxPerCycle: Money | null }): { what: LangMap; how_much: LangMap } {
  // A NULL ceiling is not a blank. An instruction with no cap is a materially different arrangement from one capped at
  // INR 200 a cycle, and the member is entitled to be told which one they authorised — in their own language, so the
  // phrase is a `LangMap` and not the word "unlimited" in English.
  const uncapped: LangMap = { en: 'no per-cycle limit', hi: 'per-cycle limit nahin', gu: 'પ્રતિ ચક્ર મર્યાદા નથી' };
  return { what: i.what, how_much: i.maxPerCycle === null ? uncapped : { en: money(i.maxPerCycle) } };
}

/* --------------------------------------------------------------------------------------------------------- */
/* [PC-56 TENANT-6d-8] W170'S ROUTE NOTICE                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * *"route notice to 87 pourers, Gujarati voice"* — the four variables that sentence needs, and no fifth.
 *
 * BOTH CENTRES BY NAME. A member does not know their centre's UUID and should not have to recognise its code: the
 * notice names the village they walk to. The DAY is printed even when it is today, because a diversion may be signed a
 * week ahead (`MAX_DAYS_AHEAD`) and *"tonight"* read the next morning is worse than a date; digits, because a month
 * name is a word this platform holds in no language. The SHIFT is a per-language map, so the Gujarati body says
 * *સાંજ* — which is the entire reason TENANT-6d-7 had to come first.
 *
 * NO OPTIONAL VARIABLE. The centre's own shift window (0163) would have been a nice fifth — *"17:00–19:30"* — and it
 * is deliberately left out: most centres have recorded none, so the token would render as a hole in the sentence for
 * most cooperatives, which is the defect 6d-7 spent a wave removing. A window that most tenants do not have is not a
 * sentence this platform can promise.
 */
export function diversionNoticeVars(i: {
  fromName: string; toName: string; day: string; shift: MilkShift; labels: DairyNoticeLabels;
}): { from: string; to: string; day: string; shift: LangMap } {
  return { from: i.fromName, to: i.toName, day: dayText(i.day), shift: i.labels.shift[i.shift] };
}
