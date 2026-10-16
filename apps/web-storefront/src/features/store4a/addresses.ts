// apps/web-storefront/src/features/store4a/addresses.ts · PC-56 STORE-4a · C3 / C6 — the ADDRESS BOOK's pure half (W301 + the form chain
// W3034–W3037 + the mutate chain W3038–W3040). No React, no Next, no I/O; unit-tested in test/store4a-account.spec.ts. The form's rule is
// features/address/form.ts (ONE copy, shared with checkout).
//
// • A card: the label BY CODE (`store4a.label.<code>` ×3 — founder D4; an organisation's own code prints its vocabulary name), the lines, the
//   country, the receiver with the phone MASKED, the delivery note, the default badge.
// • The remove confirm (W3038) says what is TRUE: "orders already heading there keep their copy" (a removed address is soft-retired — every
//   order and shipment keeps pointing at it), and, when it is the default, "your newest other address becomes the default" (the API's rule).
// • Outcomes are NAMED (W3037 / W3040): validation · unknown label · not found · concurrency · server.
import { maskForDisplay } from '../chain/mask';

export const PLATFORM_LABEL_CODES = ['home', 'farm', 'shop', 'warehouse', 'delivery'] as const;
/** A label's words: the platform's five by code in three languages; an organisation's own code → its vocabulary name (`fallback`). */
export function labelText(code: string | null | undefined, fallback: string | null, t: (k: string) => string): string | null {
  if (!code) return null;
  return (PLATFORM_LABEL_CODES as readonly string[]).includes(code) ? t(`store4a.label.${code}`) : (fallback ?? code);
}
export interface BookCard {
  id: string; labelCode: string | null; lines: string; countryCode: string | null; receiver: string | null; phoneMasked: string | null;
  deliveryNote: string | null; isDefault: boolean;
}
export function bookCard(a: { id: string; line1: string; line2?: string | null; village?: string | null; pincode?: string | null; countryCode?: string | null;
  contactName?: string | null; contactPhone?: string | null; labelCode?: string | null; deliveryNote?: string | null; isDefault: boolean }): BookCard {
  return {
    id: a.id, labelCode: a.labelCode ?? null,
    lines: [a.line1, a.line2, a.village, a.pincode].filter((x) => typeof x === 'string' && x.trim() !== '').join(', '),
    countryCode: a.countryCode ?? null, receiver: a.contactName?.trim() || null,
    phoneMasked: a.contactPhone ? maskForDisplay(a.contactPhone) : null, deliveryNote: a.deliveryNote?.trim() || null, isDefault: a.isDefault === true,
  };
}
/** The book's order is the API's (default first, then newest) — the page never re-sorts. The newest OTHER address = the first non-default
 *  after this one is gone — what the API promotes (said in the confirm, never computed into an id the page acts on). */
export function removesDefault(cards: readonly BookCard[], id: string): boolean { return cards.some((c) => c.id === id && c.isDefault); }

export const MUTATE_ACTS = ['remove', 'default'] as const;
export type MutateAct = (typeof MUTATE_ACTS)[number];
export const BOOK_OK = ['created', 'saved', 'copied', 'removed', 'default'] as const;
export type BookOk = (typeof BOOK_OK)[number];
export const ADDRESS_FAILURES = ['validation', 'label', 'not_found', 'concurrency', 'server'] as const;
export type AddressFailure = (typeof ADDRESS_FAILURES)[number];
/** The API's refusal → the named failure (W3037 / W3040). */
export function addressFailureOf(code: string | null, status: number | null): AddressFailure {
  if (code === 'ADDRESS_LABEL_UNKNOWN') return 'label';
  if (code === 'VALIDATION_FAILED' || code === 'ADDRESS_INVALID' || status === 422 || status === 400) return 'validation';
  if (code === 'ADDRESS_NOT_FOUND' || status === 404) return 'not_found';
  if (status === 409) return 'concurrency';
  return 'server';
}
export function readFailure(raw: unknown): AddressFailure | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && (ADDRESS_FAILURES as readonly string[]).includes(v) ? (v as AddressFailure) : null;
}
/** A key minted at render (`address:<uuid>`) — re-validated on the way in; anything else is refused (a Retry re-renders with the same one). */
export const ADDRESS_KEY_RE = /^address:[0-9a-f-]{36}$/;
export function readKey(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && ADDRESS_KEY_RE.test(v) ? v : null;
}
