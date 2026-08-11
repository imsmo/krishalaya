// modules/identity/domain/member-import-row.ts · reading one row of W156's file (PC-56 TENANT-1b-4).
//
// Pure functions over a `Record<string, string>` straight out of a CSV. Everything here is testable without a database,
// which matters because **the file is written by a human at an SHG meeting** and every shape below is one somebody has
// actually typed: a phone number with spaces, a nine-digit number missing a digit, a role written in Gujarati, a blank
// line, a name in a column the header calls something else.
import { normalizePhoneE164 } from '../../../shared/utils/phone';

/** W156's own template columns. `phone` is the only one that MUST be there — everything else has a sensible absence. */
export const MEMBER_IMPORT_COLUMNS = ['phone', 'full_name', 'role', 'language', 'village'] as const;

/** The role a row gets when it names none. `farmer` because W156 is a FARMER import at an SHG meeting, and because a
 *  wrong-but-harmless default beats refusing a whole file over a column the operator left blank. */
export const DEFAULT_IMPORT_ROLE = 'farmer';

export type RowRead =
  | { ok: true; phone: string; fullName: string | null; roleCode: string; languageCode: string | null; village: string | null }
  | { ok: false; code: 'PHONE_MISSING' | 'PHONE_INVALID' | 'ROW_EMPTY'; message: string }
  | { ok: false; code: 'ROLE_UNKNOWN'; message: string; fixable: true; suggestion?: string };

const trim = (v: string | undefined) => (v ?? '').trim();

/**
 * **A DEFECT IN THE SHARED NORMALISER, FIXED HERE AND NOT THERE — DELIBERATELY.**
 *
 * `normalizePhoneE164` validates against `/^\+[1-9]\d{7,14}$/`, which is E.164's global range. So `+91 90123 4541` — nine
 * subscriber digits, W156's own "one digit short" example row — PASSES: eleven digits after the plus is inside 7–14. An
 * Indian mobile number is exactly ten digits, always.
 *
 * Tightening the shared normaliser would be the obvious fix and it is the dangerous one: any account already stored with a
 * short number would stop normalising, and that person is locked out of their own login. So the strict check lives at the
 * IMPORT front door, where bad data ENTERS and where a refusal costs somebody a corrected spreadsheet cell rather than
 * their access. TENANT-1b-4-Q4 carries the wider question: how many accounts already hold one.
 */
export function isPlausibleIndianMobile(e164: string): boolean {
  if (!e164.startsWith('+91')) return true;   // another country's rules are not ours to guess
  return /^\+91[6-9]\d{9}$/.test(e164);      // ten digits, and Indian mobiles start 6-9
}

/**
 * Read one row.
 *
 * **THE PHONE IS THE IDENTITY AND IT IS NORMALISED, NOT VALIDATED-THEN-STORED-RAW.** `normalizePhoneE164` is the same
 * function the OTP login path uses, which is the point: a member imported as "98765 43210" must be the same person who
 * later signs in as "+919876543210", or the import creates a duplicate the register can never merge. W156 promises
 * "idempotent by phone number" and this is where that promise is either kept or lost.
 *
 * A NINE-DIGIT NUMBER IS FIXABLE, NOT INVALID — W156's own example row is "Hansa Ben V. · +91 90••• ••41 (9 digits) ·
 * invalid phone — one digit short · [Fix number]". The operator corrects the file; nothing here guesses the missing digit.
 */
export function readMemberRow(row: Record<string, string>, knownRoles: readonly string[]): RowRead {
  const phoneRaw = trim(row.phone);
  const nameRaw = trim(row.full_name);
  const roleRaw = trim(row.role).toLowerCase();

  // **A BLANK LINE IS ITS OWN VERDICT.** Spreadsheets carry trailing empty rows by the dozen, and reporting forty
  // "missing phone" errors for forty blank lines buries the two rows that need a human.
  if (!phoneRaw && !nameRaw && !roleRaw) {
    return { ok: false, code: 'ROW_EMPTY', message: 'blank row' };
  }
  if (!phoneRaw) {
    return { ok: false, code: 'PHONE_MISSING', message: 'no phone number — a member is identified by their phone' };
  }
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone || !isPlausibleIndianMobile(phone)) {
    return { ok: false, code: 'PHONE_INVALID', message: `"${phoneRaw}" is not a usable phone number` };
  }

  // **AN UNRECOGNISED ROLE IS FIXABLE WITH A SUGGESTION, AND THE SUGGESTION IS NEVER APPLIED.** W156 shows exactly this
  // case — a row whose role reads "khedut" (Gujarati for farmer) with "mapped to farmer? confirm" beside it. Silently
  // accepting the guess is how somebody becomes a `dairy_farmer` because two words looked alike, and the roles vocabulary
  // is DATA that a tenant in Bangladesh will fill with words this code has never seen.
  const roleCode = roleRaw || DEFAULT_IMPORT_ROLE;
  if (!knownRoles.includes(roleCode)) {
    const suggestion = suggestRole(roleCode, knownRoles);
    return {
      ok: false, code: 'ROLE_UNKNOWN', fixable: true,
      message: `"${roleRaw}" is not a role in this organisation`,
      ...(suggestion ? { suggestion } : {}),
    };
  }

  return {
    ok: true,
    phone,
    // **AN ABSENT NAME IS null AND NOT THE PHONE NUMBER.** A register full of people called "+919876543210" is worse than
    // a register with blanks: staff cannot search it, and the roster's name column becomes a second phone column.
    fullName: nameRaw || null,
    roleCode,
    languageCode: trim(row.language).toLowerCase() || null,
    village: trim(row.village) || null,
  };
}

/**
 * A role suggestion for a word this organisation does not use.
 *
 * **DELIBERATELY CONSERVATIVE: PREFIX AND CONTAINMENT ONLY, NEVER FUZZY DISTANCE.** An edit-distance match would happily
 * propose `worker` for `broker` (distance 2) and `vyapari` for `vyapaari`, and one of those two is a person selling their
 * own crop while the other is a trader — different KYC, different payout eligibility (0125). A suggestion nobody can
 * explain is worse than no suggestion, because the operator clicks confirm on it.
 */
export function suggestRole(input: string, knownRoles: readonly string[]): string | undefined {
  if (input.length < 3) return undefined;
  const exact = knownRoles.find((r) => r === input);
  if (exact) return exact;
  // `farmers` → `farmer`, `dairy` → `dairy_farmer`.
  return knownRoles.find((r) => r.startsWith(input) || input.startsWith(r));
}

/**
 * The deterministic per-row idempotency key the processor already provides is `bulkrow:<job>:<n>`, which protects a
 * RE-RUN of the same job. **THIS key protects the other case: the same person appearing twice in one file, or in two
 * different files.** Keyed on the tenant and the normalised phone, so both collapse.
 */
export function memberImportIdemKey(tenantId: string, phone: string): string {
  return `member_import:${tenantId}:${phone}`;
}
