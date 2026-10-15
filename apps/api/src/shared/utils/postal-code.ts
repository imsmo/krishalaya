// shared/utils/postal-code.ts · PC-56 STORE-2c · B4 (survey F-10, Rule Zero) — THE ONE POSTAL-CODE RULE.
//
// The address book (identity `CreateAddressSchema`) has always accepted a 4–10 digit postal code with a `countryCode`; the checkout's
// delivery-methods lookup alone insisted on an INDIAN six-digit PIN (`^[1-9][0-9]{5}$`), so a buyer in a country whose code is four or five
// digits could save an address and then never be quoted a delivery method for it. Both now read THIS rule (a fixed length range — no ReDoS).
// Known limit (named in the STORE-2c report, not widened here): postal codes with letters (UK, Canada, NL …) are refused by both, as before.
export const POSTAL_CODE_RE = /^\d{4,10}$/;
