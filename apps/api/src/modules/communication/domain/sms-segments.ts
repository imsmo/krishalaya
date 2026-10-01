// modules/communication/domain/sms-segments.ts · PC-56 TENANT-8a · W181's segment counter, in the TENANT realm.
//
// *"109 chars rendered → 2 segments (UCS-2 concatenated, 67/seg · limit ≤2 ✓)"* — W181's own sentence. The rules are
// GSM 03.38 and exist in this monorepo already, in the ADMIN realm (`apps/admin-api/.../templates-ops/domain/
// sms-segments.ts`, ADMIN-11b). Law 11 forbids tenant code importing admin code, and there is no shared package for
// domain logic, so this is a PORT: the same alphabet, the same arithmetic, pinned by its own spec in this module. If the
// two ever disagree, a tenant author and a platform author would see different costs for the same words — the specs of
// both realms pin the same boundary cases (160/161 GSM-7, 70/71 UCS-2, the extended set at two septets, an emoji at two
// UCS-2 units) so a drift fails one of them.
//
//   • a body made entirely of the GSM-7 alphabet: 160 chars in one segment, 153 per segment once concatenated;
//   • anything else — any Devanagari, Gujarati character, or an emoji — is UCS-2: 70 in one segment, 67 concatenated;
//   • seven GSM-7 characters (the extended set) cost TWO septets each.
//
// THE LENGTH THAT MATTERS IS THE RENDERED ONE: the body is counted with the event's declared SAMPLE values substituted
// by the real `NotificationTemplate.render()` (the review does that), never the template's own `{{…}}` text.

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

/** W181's cap (W102's words): "limit ≤2 unless critical". Two segments is the working budget for an ordinary notification; a critical
 *  event may exceed it, because an OTP or a dispute notice that is TRUNCATED to save a fraction of a rupee is a message
 *  that failed at the only job it had. The cap is a refusal at authoring time and never a truncation at send time. */
export const SEGMENT_BUDGET = 2;

export function exceedsSegmentBudget(segments: number, priority: string): boolean {
  if (priority === 'critical') return false;
  return segments > SEGMENT_BUDGET;
}
