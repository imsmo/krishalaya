// apps/web-storefront/src/features/address/form.ts · PC-56 STORE-4a · C6 — THE ADDRESS FORM'S ONE COPY. PURE (no React, no Next, no I/O).
//
// MOVED HERE from features/store2c/checkout.ts (STORE-2c · W3048–W3051), unchanged, because the account's address pages (W301 / W3034–W3040)
// now read the same rule and a non-checkout page must not import the checkout module. `features/store2c/checkout.ts` RE-EXPORTS every name
// below, so checkout keeps compiling against the same symbols — ONE copy of the postal rule, the field refusals, the body and the card.
//
// STORE-4a ADDS (founder D4 · Rule Zero), for the account's form only (checkout's draft codec is untouched):
//   • the delivery NOTE (≤ 280, the API's bound — 0214) and its refusal `note_too_long`;
//   • a label that must be one of the vocabulary's values the page was handed (`label`, the API re-checks: ADDRESS_LABEL_UNKNOWN);
//   • the country REQUIRED (two letters) — the API and the database no longer default it;
//   • the review step's DIFF against the current row, field by field (server values on both sides — no arithmetic, no guess).
import { maskForDisplay } from '../chain/mask';

export interface AddressValues { line1: string; line2: string; village: string; pincode: string; countryCode: string; contactName: string; contactPhone: string; labelId: string }
export type AddressFieldRefusal = 'required' | 'too_short' | 'too_long' | 'postal' | 'phone' | 'label' | 'country';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The address book's postal rule (apps/api shared/utils/postal-code.ts — 4–10 digits, any country): the SAME rule, so the form never refuses
 *  what the API accepts nor sends what it refuses. */
export const POSTAL_CODE_RE = /^\d{4,10}$/;
const PHONE_RE = /^\+?[0-9 ]{6,20}$/;

/** Read a submitted form into values (trimmed, bounded) — these are what the form re-renders on a refusal. */
export function addressValues(get: (k: string) => unknown): AddressValues {
  const v = (k: keyof AddressValues, max: number) => String(get(k) ?? '').trim().slice(0, max);
  return { line1: v('line1', 250), line2: v('line2', 250), village: v('village', 150), pincode: v('pincode', 12), countryCode: v('countryCode', 2).toUpperCase(),
    contactName: v('contactName', 150), contactPhone: v('contactPhone', 20), labelId: v('labelId', 36) };
}
/** Per-field refusals before the API is asked (it re-validates): line 1 required (3–250), a postal code by the one rule, a phone shape. */
export function checkAddress(v: AddressValues): Partial<Record<keyof AddressValues, AddressFieldRefusal>> {
  const e: Partial<Record<keyof AddressValues, AddressFieldRefusal>> = {};
  if (!v.line1) e.line1 = 'required'; else if (v.line1.length < 3) e.line1 = 'too_short';
  if (!v.pincode) e.pincode = 'required'; else if (!POSTAL_CODE_RE.test(v.pincode)) e.pincode = 'postal';
  if (v.contactPhone && !PHONE_RE.test(v.contactPhone)) e.contactPhone = 'phone';
  if (v.labelId && !UUID.test(v.labelId)) e.labelId = 'label';
  if (!/^[A-Z]{2}$/.test(v.countryCode)) e.countryCode = 'country';
  return e;
}
/** The API body for `addresses.create` (empty optionals omitted). The country is the buyer's (two letters — the address book stores it; the
 *  postal rule is the same for every country, as the API's is). */
export function addressBody(v: AddressValues): Record<string, unknown> {
  const b: Record<string, unknown> = { line1: v.line1, pincode: v.pincode, countryCode: v.countryCode };
  if (v.line2) b.line2 = v.line2;
  if (v.village) b.village = v.village;
  if (v.contactName) b.contactName = v.contactName;
  if (v.contactPhone) b.contactPhone = v.contactPhone;
  if (v.labelId) b.labelId = v.labelId;
  return b;
}
export function addressFieldKey(r: AddressFieldRefusal): string { return `store2c.address.err.${r}`; }

/** An address card (W283): its label (from the `address_label` vocabulary, when the address has one), the lines, and who receives it — the
 *  phone MASKED (features/chain/mask.ts, the five-of-ten policy). */
export interface AddressCard { id: string; label: string | null; lines: string; receiver: string | null; phoneMasked: string | null; isDefault: boolean }
export function addressCard(a: { id: string; line1: string; line2?: string | null; village?: string | null; pincode?: string | null; labelId?: string | null; contactName?: string | null; contactPhone?: string | null; isDefault: boolean }, labels: ReadonlyMap<string, string>): AddressCard {
  return {
    id: a.id, label: a.labelId ? labels.get(a.labelId) ?? null : null,
    lines: [a.line1, a.line2, a.village, a.pincode].filter((x) => typeof x === 'string' && x.trim() !== '').join(', '),
    receiver: a.contactName?.trim() || null, phoneMasked: a.contactPhone ? maskForDisplay(a.contactPhone) : null, isDefault: a.isDefault,
  };
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* STORE-4a — the ACCOUNT's form (W3034–W3037): the note, the label from the vocabulary, the review's diff                             */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
/** The API's bound on a delivery note (0214 `addresses.delivery_note varchar(280)`). */
export const DELIVERY_NOTE_MAX = 280;
export interface AccountAddressValues extends AddressValues { deliveryNote: string }
export type AccountAddressRefusal = AddressFieldRefusal | 'note_too_long';
export type AccountAddressErrors = Partial<Record<keyof AccountAddressValues, AccountAddressRefusal>>;
export const ACCOUNT_ADDRESS_FIELDS: ReadonlyArray<keyof AccountAddressValues> = ['labelId', 'line1', 'line2', 'village', 'pincode', 'countryCode', 'contactName', 'contactPhone', 'deliveryNote'];
export const ACCOUNT_ADDRESS_REFUSALS: ReadonlyArray<AccountAddressRefusal> = ['required', 'too_short', 'too_long', 'postal', 'phone', 'label', 'country', 'note_too_long'];

/** The account form's values: 2c's, plus the note (bounded a little past the API's limit so the refusal can be said, never silently cut). */
export function accountAddressValues(get: (k: string) => unknown): AccountAddressValues {
  return { ...addressValues(get), deliveryNote: String(get('deliveryNote') ?? '').trim().slice(0, DELIVERY_NOTE_MAX + 20) };
}
/** 2c's refusals + the note's bound + a label that must be one of the values the page offered (the API re-checks in the write). */
export function checkAccountAddress(v: AccountAddressValues, labelIds: ReadonlySet<string>): AccountAddressErrors {
  const e: AccountAddressErrors = { ...checkAddress(v) };
  if (v.labelId && !e.labelId && labelIds.size > 0 && !labelIds.has(v.labelId)) e.labelId = 'label';
  if (v.deliveryNote.length > DELIVERY_NOTE_MAX) e.deliveryNote = 'note_too_long';
  return e;
}
export function accountAddressFieldKey(r: AccountAddressRefusal): string { return r === 'note_too_long' ? 'store4a.address.err.noteTooLong' : addressFieldKey(r); }
/** The CREATE body: 2c's + the note. */
export function accountAddressBody(v: AccountAddressValues): Record<string, unknown> {
  const b = addressBody(v);
  if (v.deliveryNote) b.deliveryNote = v.deliveryNote;
  return b;
}
/** The EDIT patch: ONLY the fields whose value changes (an unchanged edit sends nothing, so copy-on-write never copies an address for nothing).
 *  A cleared note or label is `null` (the API clears it); a cleared free-text line is '' (the API's schema takes a string there). */
export function accountAddressPatch(current: AccountAddressValues, next: AccountAddressValues): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const f of ACCOUNT_ADDRESS_FIELDS) {
    if ((current[f] ?? '') === (next[f] ?? '')) continue;
    p[f] = next[f] === '' && (f === 'deliveryNote' || f === 'labelId') ? null : next[f];
  }
  return p;
}
/** The current row as the form's values (an edit starts from the server's values). */
export function valuesOfAddress(a: { line1: string; line2?: string | null; village?: string | null; pincode?: string | null; countryCode?: string | null; contactName?: string | null; contactPhone?: string | null; labelId?: string | null; deliveryNote?: string | null }): AccountAddressValues {
  const s = (x: string | null | undefined) => (typeof x === 'string' ? x : '');
  return { line1: s(a.line1), line2: s(a.line2), village: s(a.village), pincode: s(a.pincode), countryCode: s(a.countryCode).toUpperCase(), contactName: s(a.contactName),
    contactPhone: s(a.contactPhone), labelId: s(a.labelId), deliveryNote: s(a.deliveryNote) };
}
/** An EDIT never pre-fills the receiver's phone (the page prints it masked — PII): a BLANK phone on an edit means "keep the current one".
 *  Applied before the diff and the patch, so an untouched phone is neither shown as changed nor sent. */
export function withKeptPhone(current: AccountAddressValues | null, next: AccountAddressValues): AccountAddressValues {
  return current && next.contactPhone === '' && current.contactPhone ? { ...next, contactPhone: current.contactPhone } : next;
}
/** W3035's diff: each field whose value the edit changes, the CURRENT value beside the NEW one (both as the server holds / will hold them).
 *  A phone is compared raw and SHOWN masked. Nothing is computed beyond equality. */
export interface AddressDiffRow { field: keyof AccountAddressValues; from: string; to: string }
export function addressDiff(current: AccountAddressValues, next: AccountAddressValues): AddressDiffRow[] {
  const show = (f: keyof AccountAddressValues, v: string) => (f === 'contactPhone' && v ? maskForDisplay(v) : v);
  return ACCOUNT_ADDRESS_FIELDS.filter((f) => (current[f] ?? '') !== (next[f] ?? '')).map((f) => ({ field: f, from: show(f, current[f] ?? ''), to: show(f, next[f] ?? '') }));
}

/* the account form's server-held draft (values + refusals + the named failure) — an httpOnly cookie, never the URL (it holds a phone) */
export const ADDRESS_DRAFT_COOKIE = 'kv_address_draft';
export interface AccountAddressDraft { v: 1; mode: 'create' | 'edit'; id: string | null; values: AccountAddressValues; errors: AccountAddressErrors; failure: string | null }
export function encodeAddressDraft(d: AccountAddressDraft): string { return Buffer.from(JSON.stringify(d), 'utf8').toString('base64url'); }
/** Re-validated on the way in; a draft for ANOTHER address (or the other mode) is ignored. */
export function decodeAddressDraft(raw: string | null | undefined, mode: 'create' | 'edit', id: string | null): AccountAddressDraft | null {
  if (!raw || raw.length > 6000) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
  if (!o || o.v !== 1 || o.mode !== mode || (o.id ?? null) !== id) return null;
  const vals = (o.values ?? {}) as Record<string, unknown>;
  const values = accountAddressValues((k) => (typeof vals[k] === 'string' ? vals[k] : ''));
  const errs = (o.errors ?? {}) as Record<string, unknown>;
  const errors: AccountAddressErrors = {};
  for (const f of ACCOUNT_ADDRESS_FIELDS) if ((ACCOUNT_ADDRESS_REFUSALS as readonly string[]).includes(String(errs[f]))) errors[f] = errs[f] as AccountAddressRefusal;
  return { v: 1, mode, id, values, errors, failure: typeof o.failure === 'string' ? o.failure.slice(0, 40) : null };
}
