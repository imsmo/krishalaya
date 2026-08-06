// apps/web-ops/src/features/equipment/ear-tag.ts · PURE ear-tag normalisation for the OW-3 livestock lookup
// (PC-55 B5). Framework-free so the rule is unit-provable.
//
// INAPH ear tags (Pashu Aadhaar) are 12 digits. They are PRINTED on the tag in spaced or dashed groups, and that is
// how an operator reads one aloud at a gate — so spaces and dashes are stripped before validating rather than
// treated as a typing mistake. Anything that is still not exactly 12 digits is refused HERE, so a mistyped tag
// costs no round trip and the API never sees a query it would reject with a 422.
//
// Deliberately NOT normalised: nothing else. No trimming of "leading zeros" (a tag's zeros are part of it), no
// case folding (there are no letters), no partial/prefix search (the API takes an exact 12-digit match, and a
// console that pretended to do fuzzy matching would send an operator hunting for an animal it never searched for).
export function normaliseEarTag(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/[\s-]/g, '');
  return /^\d{12}$/.test(digits) ? digits : null;
}
