// modules/tenancy/domain/tax-identity.ts · W2424-W2427's validation as PURE rules (PC-56 TENANT-4d-3).
//
// No I/O. The FORMATS ARE AN ARGUMENT, not a constant: they arrive from `tax_identity_formats` keyed by the
// tenant's country (0147), because the previous version of this logic was a hardcoded Indian GSTIN regex applied
// to every tenant on the platform — so a Bangladeshi co-operative could not record its BIN at all. Rule zero:
// no shortcut that blocks a country.
//
// TWO PROMISES THIS FILE KEEPS THAT THE OLD CODE COULD NOT:
//   • W2424: "every invalid field is listed with its reason". `validateAll` COLLECTS errors; it never throws on
//     the first one. The old helpers threw on the spot, so a form with three bad fields reported one.
//   • W2425: "the diff against current values". `diffOf` is that diff, computed from the CLEANED values, so the
//     review step shows what will actually be stored rather than what was typed.
import { InvalidTenantProfileError } from './tenancy.errors';

/** One field's format, as stored per country. `pattern` is operator-authored (kv_app has SELECT only). */
export interface TaxIdentityFormat {
  fieldCode: TaxFieldCode;
  labelKey: string;
  pattern: string;
  maxLength: number;
  example: string | null;
  checksumAlgo: string | null;
  isRequired: boolean;
  sortOrder: number;
}

export const TAX_FIELD_CODES = ['gstin', 'pan', 'cin_or_reg_no', 'fssai_license'] as const;
export type TaxFieldCode = (typeof TAX_FIELD_CODES)[number];

/** The entity property each field code maps to. Kept explicit so a new format row cannot silently govern
 *  nothing: a code with no mapping here is refused rather than ignored. */
export const TAX_FIELD_PROPS: Readonly<Record<TaxFieldCode, 'gstin' | 'pan' | 'cinOrRegNo' | 'fssaiLicense'>> = Object.freeze({
  gstin: 'gstin', pan: 'pan', cin_or_reg_no: 'cinOrRegNo', fssai_license: 'fssaiLicense',
});

/** Where no format row exists for the tenant's country, an identifier is still accepted — as length-capped
 *  plain text. Blocking a tenant because we have not researched their country's format yet is the defect. */
export const UNFORMATTED_MAX_LENGTH = 40;

export type ChecksumVerdict =
  /** The check digit was computed and agrees. */
  | 'verified'
  /** Computed and DISAGREES — almost always a typo. **An ADVISORY, not a refusal**: see checksumAdvisory below. */
  | 'failed'
  /** This format has no check digit (FSSAI, CIN) — nothing to verify, which is not the same as unverified. */
  | 'not_applicable'
  /** No format recorded for the country, or an algorithm name this build does not implement. */
  | 'not_verifiable';

export type FieldVerdict =
  | { kind: 'ok'; checksum: ChecksumVerdict }
  | { kind: 'cleared' }                                    // the tenant deliberately removed the value
  | { kind: 'error'; reason: FieldErrorReason; detail?: string };

export type FieldErrorReason =
  | 'malformed'            // failed the country's pattern
  | 'too_long'
  | 'not_plain_text'
  | 'required';

export interface FieldError { field: TaxFieldCode | ProfileFieldCode; reason: FieldErrorReason; detail?: string }

/** The non-tax profile fields on the same form (W120's "GST details" block also carries the billing contact). */
export const PROFILE_FIELD_CODES = ['legalName', 'ownerName', 'ownerPhone', 'ownerEmail'] as const;
export type ProfileFieldCode = (typeof PROFILE_FIELD_CODES)[number];

export interface TaxIdentityPatch {
  gstin?: string | null; pan?: string | null; cin_or_reg_no?: string | null; fssai_license?: string | null;
  legalName?: string; ownerName?: string | null; ownerPhone?: string | null; ownerEmail?: string | null;
}

export interface CurrentIdentity {
  gstin: string | null; pan: string | null; cinOrRegNo: string | null; fssaiLicense: string | null;
  legalName: string; ownerName: string | null; ownerPhone: string | null; ownerEmail: string | null;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE CHECK DIGIT                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';   // base-36, positionally weighted

/**
 * A GSTIN's 15th character is a check digit over the first 14 — Luhn mod 36, walking RIGHT TO LEFT with the
 * factor starting at 2, folding each addend as `floor(a/36) + a%36`. The old regex accepted ANY alphanumeric
 * there, so a one-character typo validated. Since TENANT-4d-2 the GSTIN is SNAPSHOTTED onto every invoice at
 * issue (0146 §146.3) so documents cannot be re-addressed later — a typo therefore becomes a permanent,
 * per-document statutory error on precisely the field a finance team files with.
 *
 * **THIS ADVISES; IT DOES NOT REFUSE — AND THAT IS A DELIBERATE LIMIT, NOT AN OVERSIGHT.** The implementation
 * agrees with the published specimen `27AAPFU0939F1ZV`, and it could not be checked against an authoritative
 * GSTN source from the build environment this wave was written in (no external network). A checksum that is
 * subtly wrong in a way one specimen cannot reveal would REFUSE correct numbers — which blocks a tenant from
 * recording a GSTIN that is genuinely theirs, and that is a trust cost rule zero forbids. So a mismatch is
 * surfaced at the review step, in front of a human who is already reading the diff, and the tenant may proceed
 * deliberately. Promote it to a hard refusal once the algorithm is verified against the GSTN specification —
 * one line in `validateAll`, recorded in 0147's header as a founder decision.
 *
 * Most illustrative GSTINs in circulation are NOT checksum-valid (they are built on the canonical dummy PAN
 * `AABCU9603R`), which is exactly why a mismatch cannot mean "reject".
 */
export function gstinChecksumOk(value: string): boolean {
  if (value.length !== 15) return false;
  let sum = 0;
  let factor = 2;
  for (let i = 13; i >= 0; i--) {
    const d = ALPHABET.indexOf(value[i]);
    if (d < 0) return false;
    const addend = factor * d;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / 36) + (addend % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36] === value[14];
}

/** Algorithms BY NAME. A name this map does not implement behaves exactly like NULL — `not_verifiable` — and
 *  never like a pass, so adding a format row with an unknown algorithm cannot quietly weaken validation. */
const CHECKSUMS: Readonly<Record<string, (v: string) => boolean>> = Object.freeze({ gstin_mod36: gstinChecksumOk });

export function checksumSupported(algo: string | null): boolean {
  return algo !== null && Object.prototype.hasOwnProperty.call(CHECKSUMS, algo);
}

/* ---------------------------------------------------------------------------------------------------------- */
/* VALIDATION — EVERY FIELD, EVERY REASON, IN ONE PASS                                                        */
/* ---------------------------------------------------------------------------------------------------------- */

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const PHONE_RE = /^\+?[0-9]{6,15}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function plainTextProblem(s: string): FieldErrorReason | null {
  return /[<>]/.test(s) || CONTROL_RE.test(s) ? 'not_plain_text' : null;
}

export interface ValidationResult {
  /** Empty when the patch is acceptable. Otherwise EVERY problem, one entry per field. */
  errors: FieldError[];
  /** Per-field verdicts including the checksum state, so the review screen can say "check digit verified"
   *  for a GSTIN and "not verified" for an FSSAI number without inferring it. */
  verdicts: Partial<Record<TaxFieldCode, FieldVerdict>>;
  /** The values as they would be STORED (trimmed, upper-cased per format). Only fields actually supplied. */
  cleaned: Partial<CurrentIdentity>;
}

/**
 * Validate a whole patch against the tenant's country formats. Collects; never throws.
 *
 * A field explicitly set to null is a CLEAR — a tenant deregistering, or correcting a value that should never
 * have been there — and is allowed unless the format says the field is required.
 */
export function validateAll(formats: readonly TaxIdentityFormat[], patch: TaxIdentityPatch): ValidationResult {
  const byCode = new Map(formats.map((f) => [f.fieldCode, f]));
  const errors: FieldError[] = [];
  const verdicts: Partial<Record<TaxFieldCode, FieldVerdict>> = {};
  const cleaned: Partial<CurrentIdentity> = {};

  for (const code of TAX_FIELD_CODES) {
    const raw = patch[code];
    if (raw === undefined) continue;                        // not being changed
    const prop = TAX_FIELD_PROPS[code];
    const fmt = byCode.get(code);

    if (raw === null || raw.trim() === '') {
      if (fmt?.isRequired) { errors.push({ field: code, reason: 'required' }); continue; }
      verdicts[code] = { kind: 'cleared' };
      cleaned[prop] = null;
      continue;
    }

    // LENGTH BEFORE PATTERN, always: it bounds what the (operator-authored) regex can be asked to chew on,
    // and it is also the more useful error — "15 characters" beats "malformed" when someone pasted a sentence.
    const s = raw.trim().toUpperCase();
    const max = fmt?.maxLength ?? UNFORMATTED_MAX_LENGTH;
    if (s.length > max) { errors.push({ field: code, reason: 'too_long', detail: String(max) }); continue; }
    const plain = plainTextProblem(s);
    if (plain) { errors.push({ field: code, reason: plain }); continue; }

    if (!fmt) {
      // No format recorded for this country. Accepted as plain text, and the verdict SAYS the shape was not
      // checked — the alternative was refusing a correct number because we have not researched the country.
      verdicts[code] = { kind: 'ok', checksum: 'not_verifiable' };
      cleaned[prop] = s;
      continue;
    }
    if (!new RegExp(fmt.pattern).test(s)) {
      errors.push({ field: code, reason: 'malformed', detail: fmt.example ?? undefined });
      continue;
    }
    if (checksumSupported(fmt.checksumAlgo)) {
      // ADVISORY, not a refusal (see gstinChecksumOk for the full argument): the value is stored and the
      // mismatch is reported, so a human sees "this looks like a typo" at the review step rather than a
      // correct-but-unfamiliar number being rejected outright.
      verdicts[code] = { kind: 'ok', checksum: CHECKSUMS[fmt.checksumAlgo as string](s) ? 'verified' : 'failed' };
    } else {
      // Either the format has no check digit (FSSAI, CIN) or names one we do not implement. Both read as
      // "not verified" — never as verified, which is the four-verdict discipline: unverifiable is not a tick.
      verdicts[code] = { kind: 'ok', checksum: fmt.checksumAlgo === null ? 'not_applicable' : 'not_verifiable' };
    }
    cleaned[prop] = s;
  }

  // ---- the billing-contact fields on the same form -------------------------------------------------------
  if (patch.legalName !== undefined) {
    const s = patch.legalName.trim();
    if (!s) errors.push({ field: 'legalName', reason: 'required' });
    else if (s.length > 250) errors.push({ field: 'legalName', reason: 'too_long', detail: '250' });
    else if (plainTextProblem(s)) errors.push({ field: 'legalName', reason: 'not_plain_text' });
    else cleaned.legalName = s;
  }
  if (patch.ownerName !== undefined) {
    const v = patch.ownerName;
    if (v === null || v.trim() === '') cleaned.ownerName = null;
    else if (v.trim().length > 200) errors.push({ field: 'ownerName', reason: 'too_long', detail: '200' });
    else if (plainTextProblem(v.trim())) errors.push({ field: 'ownerName', reason: 'not_plain_text' });
    else cleaned.ownerName = v.trim();
  }
  if (patch.ownerPhone !== undefined) {
    const v = patch.ownerPhone;
    if (v === null || v.trim() === '') cleaned.ownerPhone = null;
    else if (!PHONE_RE.test(v.trim())) errors.push({ field: 'ownerPhone', reason: 'malformed' });
    else cleaned.ownerPhone = v.trim();
  }
  if (patch.ownerEmail !== undefined) {
    const v = patch.ownerEmail;
    if (v === null || v.trim() === '') cleaned.ownerEmail = null;
    else if (!EMAIL_RE.test(v.trim())) errors.push({ field: 'ownerEmail', reason: 'malformed' });
    else cleaned.ownerEmail = v.trim().toLowerCase();
  }

  return { errors, verdicts, cleaned };
}

/* ---------------------------------------------------------------------------------------------------------- */
/* W2425's DIFF                                                                                               */
/* ---------------------------------------------------------------------------------------------------------- */

export interface DiffRow { field: keyof CurrentIdentity; from: string | null; to: string | null }

/** The change the review step shows, computed from the CLEANED values so the tenant reviews what will be
 *  stored (upper-cased, trimmed) and not what they happened to type. Unchanged fields are absent, so a review
 *  screen with no rows means "nothing would change" — which the screen must say rather than offering Submit. */
export function diffOf(current: CurrentIdentity, cleaned: Partial<CurrentIdentity>): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const [k, to] of Object.entries(cleaned) as [keyof CurrentIdentity, string | null][]) {
    const from = current[k] ?? null;
    if ((from ?? null) !== (to ?? null)) rows.push({ field: k, from: from ?? null, to: to ?? null });
  }
  return rows;
}

export function isNoOp(diff: DiffRow[]): boolean { return diff.length === 0; }

/** The fields whose check digit did not agree. W2425 shows these ABOVE the Submit button: a typo in a number
 *  that will be frozen onto every future invoice is worth one deliberate second look. Empty is the normal case. */
export function checksumAdvisories(verdicts: Partial<Record<TaxFieldCode, FieldVerdict>>): TaxFieldCode[] {
  return (Object.entries(verdicts) as [TaxFieldCode, FieldVerdict][])
    .filter(([, v]) => v.kind === 'ok' && v.checksum === 'failed')
    .map(([code]) => code);
}

/** W2426 promises the audit entry carries a REASON. It is required exactly when a value is being REPLACED or
 *  CLEARED rather than recorded for the first time: "why did this tenant's GSTIN change?" is the question an
 *  auditor asks of a document that has already been filed, and "we are filling it in" answers itself. */
export function reasonRequired(diff: DiffRow[]): boolean {
  return diff.some((r) => r.from !== null);
}

export const REASON_MAX = 280;

export function reasonProblem(reason: string | null | undefined, diff: DiffRow[]): FieldErrorReason | null {
  const s = (reason ?? '').trim();
  if (!s) return reasonRequired(diff) ? 'required' : null;
  if (s.length > REASON_MAX) return 'too_long';
  return plainTextProblem(s);
}

/** The single throw the service makes when a patch is unacceptable — one error carrying EVERY reason, so the
 *  screen can list them. The message stays human; the `fields` payload is what W2424 renders. */
export function assertValid(result: ValidationResult): void {
  if (result.errors.length === 0) return;
  throw new InvalidTenantProfileError(
    `${result.errors.length} field(s) are invalid: ${result.errors.map((e) => `${e.field} (${e.reason})`).join(', ')}`,
    result.errors,
  );
}
