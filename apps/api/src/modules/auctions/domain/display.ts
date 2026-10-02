// modules/auctions/domain/display.ts · PC-56 TENANT-11a · HOW A BIDDER IS NAMED. PURE.
//
// F-17: canon W138 — "Bidder identities masked to each other (B1–B4) — open prices, private people". Every bid read now
// names a bidder by their ENTRY ORDER in this auction (B1 is whoever bid first; a later bid never renumbers anyone), and
// raw user ids never leave the API. The seller and the auction desk, AFTER the close, also see who the bidder is — as the
// 1b mask of the phone (`maskPhone`, imported from the member roster read model, never re-typed: a second mask is a second
// answer to how much of a member's number this console reveals) and a SHORT name (first name + initial), never a full one.
export { maskPhone } from '../../identity/read-models/member-roster.read-model';

export function bidderLabel(index: number): string { return `B${index + 1}`; }

/** "Ramesh Kumar Patel" → "Ramesh P."; one word → itself; blank → null (the screen says "name not recorded"). */
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
