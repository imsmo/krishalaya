// apps/admin-api/src/core/pii/mask.ts · server-side masking for every cross-tenant surface that names a person.
// Pure, no I/O.
//
// MOVED HERE AT ITS SECOND CONSUMER (ADMIN-5b). It was written for W074's applications list and the consent registry
// (W046) needs exactly the same thing — a masked name and phone across every tenant, with an audited unmask. The file's
// own header already complained that two module-local masks had drifted apart; making a third would have proved the
// point. One mask, one shape, one place.
//
// READ THIS FIRST, BECAUSE IT IS THE THING MOST LIKELY TO BE MISUNDERSTOOD:
//
//   MASKING IS NOT ANONYMISATION, AND THIS MODULE DOES NOT PRETEND OTHERWISE.
//
// "Ramesh P." plus a scheme plus a taluka identifies one man in a village of four hundred. Nobody is de-identified by
// anything in this file. What masking actually buys is narrower and still worth having: a screenshot pasted into a
// group chat, a laptop on a train, a CSV forwarded one hop too far, and a support agent who needs to confirm they are
// looking at the right row without reading a phone number aloud. The CONTROL is the permission
// (`schemes.applications.read`, which W074's restricted state names) plus the audit row written when somebody
// deliberately unmasks. The mask is the default, not the defence.
//
// WHY THE PLATFORM DID NOT ALREADY HAVE ONE. Two implementations existed and neither was reusable here:
//   • apps/api `maskPhone` → `+9198****3210`. Tenant realm, and it keeps the first five characters — fine for a
//     farmer confirming their own number, wrong for a cross-tenant list where the leading digits are the same for
//     every row in India and the trailing four are the identifying part.
//   • admin-api tenant-applications-ops, a module-local `••••3210`. Right shape, wrong scope, and copying it a third
//     time is how three masks drift apart.
// Neither masked a NAME, because until this wave no admin-api surface had ever returned a farmer's name.
import { HttpException, HttpStatus } from '@nestjs/common';

/** Moved with the mask. It was a schemes-oversight error and is now shared, because the reason floor is a property of
 *  DISCLOSURE rather than of any one register. */
export class UnmaskReasonRequiredError extends HttpException {
  constructor(detail: string) { super({ code: 'UNMASK_REASON_REQUIRED', message: detail, detail }, HttpStatus.UNPROCESSABLE_ENTITY); }
}

/** The canon's own rendering: `+91 98••• ••210`. Group-preserving, so an operator can still read a number aloud to
 *  confirm a row without disclosing the middle — and so the shape of a wrong number is still visible. */
export function maskPhone(e164: string | null | undefined): string | null {
  const raw = (e164 ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  // A number too short to mask is NOT returned unmasked. It is refused, because the one situation where a fallback
  // "return it as-is" matters is exactly the situation where the data is malformed and nobody is checking.
  if (digits.length < 8) return MASK_UNAVAILABLE;
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  const local = digits.slice(-10);
  const head = local.slice(0, 2);
  const tail = local.slice(-3);
  return `${cc ? `+${cc} ` : ''}${head}••• ••${tail}`;
}

/** Returned instead of a partial mask when the input cannot be masked safely. A visible token, never an empty string:
 *  a blank cell reads as "this farmer has no phone", which is a different and wrong fact. */
export const MASK_UNAVAILABLE = '••••••••';

/** The canon's `Ramesh P.` / `Meera Ben J.` — every token but the last, then the last token's initial.
 *
 *  THE ONE-TOKEN CASE IS NOT AN EDGE CASE IN INDIA. A great many people have a single name and no surname; some have
 *  four tokens; some have an honorific mid-name ("Meera Ben J." keeps "Ben"). So the rule is positional and not
 *  "first name + surname initial": keep everything except the final token, initialise the final token. A single-token
 *  name is returned WHOLE rather than reduced to one letter, because "R." is not a name and a list of "R." "S." "M."
 *  is unusable — and reducing a mononymous person to an initial while a three-token person keeps two words is the
 *  kind of quiet unfairness nobody notices in review.
 */
export function maskName(fullName: string | null | undefined): string | null {
  const raw = (fullName ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  const parts = raw.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  // `Array.from`, not `last[0]`. MY FIRST COMMENT HERE WAS WRONG AND A MUTATION TEST CAUGHT IT: Devanagari and
  // Gujarati letters are in the BMP (प is U+092A, one UTF-16 unit), so `last[0]` handles them perfectly well. What
  // `Array.from` actually protects against is ASTRAL characters — a name field containing an emoji or a historic
  // script, where `last[0]` returns a lone surrogate and the cell renders as a replacement glyph. That is a real case
  // (people do put emoji in name fields) and it is worth the iterator.
  //
  // AND A LIMITATION NEITHER FORM FIXES, NAMED RATHER THAN PAPERED OVER: an Indic initial plus a combining vowel sign
  // ("पा" is प U+092A + ा U+093E, two code points) is truncated to the bare consonant, so the initial of "पाटील" shows
  // as "प." rather than "पा.". That is a slightly different letter to a Gujarati or Marathi reader. Fixing it properly
  // needs grapheme-cluster segmentation (Intl.Segmenter), which is a real change with real behaviour to verify — it is
  // not done here rather than done badly, and this is where the next person will find the reason.
  const initial = Array.from(last)[0] ?? '';
  return `${parts.slice(0, -1).join(' ')} ${initial}.`;
}

/** A government application reference is not PII, and is deliberately NOT masked: it is the string an operator quotes
 *  to a government office to chase a filing, and a masked one is useless for the only thing it is for. */
export function govtRefFor(ref: string | null | undefined): string | null {
  const v = (ref ?? '').trim();
  return v || null;
}

/** The masked shape of an applicant, as the LIST returns it. There is no unmasked variant of this type on purpose:
 *  full PII travels on a different, separately-audited path, and a single type with an optional `phone` field would
 *  make the unmasked case reachable by forgetting a flag. */
export interface MaskedApplicant {
  userId: string;
  nameMasked: string | null;
  phoneMasked: string | null;
  /** True when this row's PII was reduced by the mask — so the console can say WHY a name looks abbreviated rather
   *  than leaving an operator to wonder whether the record itself is incomplete. */
  masked: true;
}

export function maskApplicant(row: { userId: string; fullName: string | null; phone: string | null }): MaskedApplicant {
  return {
    userId: row.userId,
    nameMasked: maskName(row.fullName),
    phoneMasked: maskPhone(row.phone),
    masked: true,
  };
}

/** The reason an unmask was requested. Mandatory, minimum length, and it lands in the audit row — because "who looked
 *  at this farmer's phone number, and why" is the only question that matters after the fact, and a system that logs
 *  the who without the why answers half of it. */
export function assertUnmaskReason(v: unknown): string {
  if (typeof v !== 'string') throw new UnmaskReasonRequiredError('an unmask reason is required');
  const s = v.trim();
  if (s.length < UNMASK_REASON_MIN) {
    throw new UnmaskReasonRequiredError(`an unmask reason must be at least ${UNMASK_REASON_MIN} characters — it is the audit trail, and 'checking' answers nothing`);
  }
  if (s.length > 500) throw new UnmaskReasonRequiredError('an unmask reason must be at most 500 characters');
  return s;
}

/** Ten, not three. The other mandatory reasons on this platform accept three characters because they accompany an
 *  action whose object is already recorded; this one is the ONLY record of why a farmer's phone number was read, and
 *  three characters lets 'wip' through. */
export const UNMASK_REASON_MIN = 10;
