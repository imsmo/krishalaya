// modules/templates-ops/domain/sms-segments.ts · W102's segment counter (PC-56 ADMIN-11b).
//
// **WHY A COST FUNCTION SITS IN A TEMPLATE PLANE.** W102 prints "84 chars rendered → 2 segments (Gujarati = UCS-2
// concatenated, 67 chars/segment · limit ≤2 unless critical)". An SMS is billed PER SEGMENT, and the difference between
// a 2-segment and a 3-segment Gujarati template is fifty per cent more money on every send of that event, for ever, to
// millions of recipients. A wording change is a pricing change, and the author is the only person positioned to see it
// — which is why the number belongs on the authoring screen and not in a monthly cost report.
//
// The rules are GSM 03.38 and are not negotiable by us:
//   • a body made entirely of the GSM-7 alphabet: 160 chars in one segment, 153 per segment once concatenated
//     (7 of the 160 are spent on the concatenation header)
//   • anything else — any Devanagari, Gujarati, Bengali, Arabic character, or an emoji — is UCS-2: 70 chars in one
//     segment, 67 per segment concatenated
//   • seven GSM-7 characters cost TWO each (the extended set: { } [ ] ~ ^ \ and |, plus € and a form feed)
//
// **THE LENGTH THAT MATTERS IS THE RENDERED ONE, NOT THE TEMPLATE'S.** `{{order_id}}` is eleven characters in the body
// and fifteen once it becomes ORD-2026-088412. Counting the template would under-report every single time, always in
// the direction that hides a cost, so this module counts a body with its declared SAMPLE values substituted.

/** The GSM-7 default alphabet (3GPP TS 23.038). Written out rather than approximated by a regex range: a range that
 *  accidentally includes one character outside the alphabet silently converts a whole template to UCS-2 in the count
 *  and not in reality, which is the wrong direction to be wrong in. */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** The seven that occupy TWO septets each, because they are reached through an escape. A body of 80 curly braces is
 *  160 septets and therefore already two segments — a shape a naive `length` check calls single. */
const GSM7_EXTENDED = '^{}\\[~]|€';

export type SmsEncoding = 'gsm7' | 'ucs2';

export interface SegmentCount {
  encoding: SmsEncoding;
  /** Billable units: septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
  perSegment: number;
  /** Rendered characters, for the "84 chars rendered" half of W102's sentence. */
  characters: number;
}

/** Which encoding a body forces. One character outside the GSM-7 alphabet decides it for the whole message — there is
 *  no partial GSM-7, which is why a single stray curly quote in an English template triples its cost. */
export function encodingOf(text: string): SmsEncoding {
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENDED.includes(ch)) return 'ucs2';
  }
  return 'gsm7';
}

/** Billable units. Uses code-POINT iteration for the alphabet test and code-UNIT length for UCS-2, because that is how
 *  the air interface bills: an emoji is one code point and TWO UCS-2 units. Counting it as one would under-report. */
export function unitsOf(text: string, encoding: SmsEncoding): number {
  if (encoding === 'ucs2') return [...text].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  let n = 0;
  for (const ch of text) n += GSM7_EXTENDED.includes(ch) ? 2 : 1;
  return n;
}

export function segmentsFor(text: string): SegmentCount {
  const encoding = encodingOf(text);
  const single = encoding === 'gsm7' ? 160 : 70;
  const concat = encoding === 'gsm7' ? 153 : 67;
  const units = unitsOf(text, encoding);
  // An EMPTY body is zero segments, not one. A template with no words is a defect the authoring plane refuses
  // elsewhere; reporting it as a billable segment here would hide it behind a plausible number.
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / concat);
  return { encoding, units, segments, perSegment: segments <= 1 ? single : concat, characters: [...text].length };
}

/** Substitute the DECLARED samples so the count is of what a recipient receives. An undeclared variable renders EMPTY,
 *  exactly as `NotificationTemplate.render()` does at send time — so the count under-reports a body full of typos, and
 *  the authoring plane refuses those separately rather than letting this function guess a width for them. */
export function renderWithSamples(body: string, samples: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]{1,64})\s*\}\}/g, (_m, k: string) => samples[k] ?? '');
}

/** W102's cap: "limit ≤2 unless critical". Two segments is the working budget for an ordinary notification; a critical
 *  event may exceed it, because an OTP or a dispute notice that is TRUNCATED to save a fraction of a rupee is a message
 *  that failed at the only job it had. The cap is a refusal at authoring time and never a truncation at send time. */
export const SEGMENT_BUDGET = 2;

export function exceedsSegmentBudget(segments: number, priority: string): boolean {
  if (priority === 'critical') return false;
  return segments > SEGMENT_BUDGET;
}

/**
 * **DLT PLACEHOLDER MAPPING.** India's DLT registry uses `{#var#}` where this platform uses `{{var}}`, and a template
 * registered with the wrong placeholder syntax fails content scrubbing at the operator — which does not bounce with a
 * useful error, it simply stops delivering. W102 prints the mapping as a one-line hint; this produces the string an
 * operator pastes into the DLT portal.
 *
 * DLT allows at most 30 variables and ignores their names, so the output is deliberately positional.
 */
export function toDltTemplate(body: string): string {
  return body.replace(/\{\{\s*[a-zA-Z0-9_.]{1,64}\s*\}\}/g, '{#var#}');
}
