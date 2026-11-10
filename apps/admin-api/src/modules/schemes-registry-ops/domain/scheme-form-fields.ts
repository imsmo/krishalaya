// apps/admin-api/src/modules/schemes-registry-ops/domain/scheme-form-fields.ts · PC-56 GOV-2a · B2f — THE FORM FIELDS A SCHEME VERSION ASKS FOR
// (GOV-2 Q3-A, lead-applied 2026-11-10; the founder may reopen). Pure, no I/O.
//
// Each version declares its form fields — [{ key, label, kind, personal }] — in the draft → publish plane (maker ≠ checker, 0105); once
// published they are frozen with the rest of the version (0240 replaces 0105's immutability trigger to cover them). A government authority
// reads an application's DECLARED fields only, `personal` ones masked (••••••xyz); an undeclared key never leaves the database.
//
// THE SAME RULES AS 0240's `kv_scheme_form_fields_valid()` CHECK (a copy, as `rejection-codes.ts` copies 0106 — the database is the wall):
//   • at most 100 fields; keys unique, `^[A-Za-z][A-Za-z0-9_]{0,59}$`; a label of 1–120 plain characters; kind ∈ KINDS; personal a boolean;
//   • a key that IS a person's name (`farmerName`; `cropName` is not), or names a village or caste — or a phone / Aadhaar / bank / account /
//     IFSC / UPI / PAN — MUST be personal (0240's `kv_form_key_must_be_personal`);
//   • a location key (lat / lng / gps / location / address / boundary …) cannot be declared at all.
import { InvalidSchemeInputError } from './schemes-registry.errors';

export const FORM_FIELD_KINDS = ['text', 'number', 'date', 'boolean', 'choice'] as const;
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];
export interface FormField { key: string; label: string; kind: FormFieldKind; personal: boolean }
export const MAX_FORM_FIELDS = 100;

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const LOCATION_TOKEN = /_(lat|lng|lon|latitude|longitude|geo|geotag|geotags|gps|location|locations|coords|coordinates|trace|walk|address|boundary|polygon|geojson)_/;
/** A key that IS a person's name (whole key: `farmerName` yes, `cropName` no) … */
const PERSON_NAME_KEY = /^_(name|names|full_name|fullname|first_name|middle_name|last_name|surname|farmer_name|applicant_name|beneficiary_name|father_name|fathers_name|mother_name|husband_name|spouse_name|guardian_name)_$/;
/** … or that names, anywhere, a village, a caste or one of GOV-0's identifiers. */
const PERSONAL_TOKEN = /_(village|caste|phone|phones|mobile|msisdn|aadhaar|aadhar|uid|bank|account|acct|ifsc|upi|vpa|pan)_/;

/** `farmerName` → `_farmer_name_` (0239/0240's tokeniser). */
export function keyTokens(key: string): string {
  return `_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase()}_`;
}
export function mustBePersonal(key: string): boolean { const t = keyTokens(key); return PERSON_NAME_KEY.test(t) || PERSONAL_TOKEN.test(t); }
export function isLocationKey(key: string): boolean { return LOCATION_TOKEN.test(keyTokens(key)); }

/** Validate a declared field list; returns it normalised (labels trimmed). Throws a 422 naming the first problem. */
export function assertFormFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) throw new InvalidSchemeInputError('form_fields must be an array');
  if (value.length > MAX_FORM_FIELDS) throw new InvalidSchemeInputError(`form_fields exceeds ${MAX_FORM_FIELDS} entries`);
  const seen = new Set<string>();
  return value.map((raw, i) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new InvalidSchemeInputError(`form_fields[${i}] must be an object`);
    const f = raw as Record<string, unknown>;
    const extra = Object.keys(f).filter((k) => !['key', 'label', 'kind', 'personal'].includes(k));
    if (extra.length) throw new InvalidSchemeInputError(`form_fields[${i}] carries unknown keys: ${extra.join(', ')}`);
    if (typeof f.key !== 'string' || !KEY_RE.test(f.key)) throw new InvalidSchemeInputError(`form_fields[${i}].key must match ${KEY_RE.source}`);
    if (seen.has(f.key)) throw new InvalidSchemeInputError(`form_fields key "${f.key}" is declared twice`);
    seen.add(f.key);
    const label = typeof f.label === 'string' ? f.label.trim() : '';
    if (!label || label.length > 120 || /[<>]/.test(label)) throw new InvalidSchemeInputError(`form_fields[${i}].label must be 1–120 plain characters`);
    if (typeof f.kind !== 'string' || !(FORM_FIELD_KINDS as readonly string[]).includes(f.kind)) throw new InvalidSchemeInputError(`form_fields[${i}].kind must be one of ${FORM_FIELD_KINDS.join(', ')}`);
    if (typeof f.personal !== 'boolean') throw new InvalidSchemeInputError(`form_fields[${i}].personal must be true or false`);
    if (isLocationKey(f.key)) throw new InvalidSchemeInputError(`form_fields key "${f.key}" is a location — a location is never declared`);
    if (mustBePersonal(f.key) && f.personal !== true) throw new InvalidSchemeInputError(`form_fields key "${f.key}" names personal data and must be declared personal`);
    return { key: f.key, label, kind: f.kind as FormFieldKind, personal: f.personal };
  });
}
