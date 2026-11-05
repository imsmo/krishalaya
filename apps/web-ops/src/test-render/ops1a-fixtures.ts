// apps/web-ops/src/test-render/ops1a-fixtures.ts · PC-56 OPS-1a — the render harness's shared pieces (B21): the i18n test catalogue loader
// (`tr`: a catalogue → a translator with en fallback, the web-partner shape), a visible-text extractor, the bills as the API answers them
// (minor-unit strings; no name — the list carries none), and the canon's false words as one visible-text regex. No canon person, member number,
// bill / receipt / booking reference, place or figure.
import type { MilkBill } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';

/** A catalogue → the translator shape the views take (missing keys fall back to en, then to the key). */
export const tr = (cat: Record<string, string>) => ({ t: (key: string, vars: Record<string, string | number> = {}) => (cat[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (_m, n) => (n in vars ? String(vars[n]) : `{${n}}`)) });
/** Text of the markup with tags removed and the entities React escapes restored. */
export const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** Visible text OUTSIDE the refusal list (the list names what it refuses). */
export const visible = (html: string) => text(html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/g, ''));
export const percents = (s: string) => (s.match(/%/g) ?? []).length;

const bill = (over: Partial<MilkBill>): MilkBill => ({
  id: '0192d2c4-b001-7000-8000-000000000001', membershipId: 'm-0001', periodStart: '2026-10-01', periodEnd: '2026-10-10', totalLitres: '120.500',
  grossMinor: '812345', deductionsMinor: '43210', netMinor: '769135', status: 'previewed', disputeWindowEnds: '2026-10-12T12:30:00.000Z', payoutId: null, ...over,
});
/** Three bills: amounts chosen so that NO sum of any two (or all three) is printed by accident — a computed total would be a new figure. */
export const BILLS_1A: MilkBill[] = [
  bill({}),
  bill({ id: '0192d2c4-b001-7000-8000-000000000002', membershipId: 'm-0002', grossMinor: '501000', deductionsMinor: '0', netMinor: '501000', status: 'draft', disputeWindowEnds: null }),
  bill({ id: '0192d2c4-b001-7000-8000-000000000003', membershipId: 'm-0003', grossMinor: '333300', deductionsMinor: '11100', netMinor: '322200', status: 'disputed' }),
];
export const CODES_1A: Record<string, string> = { 'm-0001': 'TC-01', 'm-0002': 'TC-02' };   // m-0003 deliberately absent → "not on this list"

/** The canon's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_1A = /%|zero-sum|reconcil|wage[- ]lane|page \d+ of \d+|went to every member|across organisations|forever|pays nobody|partial release|\bNOC\b|0\.5 ?%|depositor-only|receipt balance|plan settings|=|−|Send to tenant payout desk|Vanthali|Gondal|Anand|Meera|Ramesh|Patel|MB-0781|NERL-26|SB-2026|GJ-0412|\b214\b/i;
/** Any form control. */
export const INPUTS = /<input|<textarea/gi;
export const CONTROLS = /<input|<select|<textarea|<form|<button/i;
