// modules/requirements/domain/display.ts · PC-56 TENANT-11d · F-14 — HOW A BUYER OR A SELLING MEMBER IS NAMED. PURE.
//
// Canon W131 names the buyer ("Saurashtra Oil Mills") and W132 the responders ("Junagadh Kisan Producer Co. · 40 qtl @ ₹6,480").
// The platform records a person's full name and phone; it records NO organisation name for a buyer (no column exists — the
// console says "organisation not recorded" rather than inventing one). A name is SHORT ("Suresh B."), a phone is the 1b MASK,
// imported from the member roster read model, never re-typed (a second mask is a second answer to how much of a member's
// number this console reveals).
export { maskPhone } from '../../identity/read-models/member-roster.read-model';

/** "Suresh Bhai Bhatt" → "Suresh B."; one word → itself; blank → null (the screen says "name not recorded"). */
export function shortName(full: string | null | undefined): string | null {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0].slice(0, 40);
  return `${parts[0].slice(0, 40)} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

/** Reasons are recorded verbatim; the bounds are the shared mutate chain's (features/mutate/chain.ts MIN/MAX_REASON). */
export const MIN_REASON = 3;
export const MAX_REASON = 300;
export function cleanReason(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length >= MIN_REASON && s.length <= MAX_REASON ? s : null;
}

/** The label the member-stock match prints, word for word (A6, refused by name: no AI score exists). */
export const MATCH_RULE = 'stock match (rule-based) — AI score not yet available';
