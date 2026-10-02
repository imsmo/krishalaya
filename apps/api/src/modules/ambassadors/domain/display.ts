// modules/ambassadors/domain/display.ts · PC-56 TENANT-10a · F-16 — HOW A PERSON IS NAMED ON THESE SCREENS. PURE.
//
// The roster printed a raw user id; the canon prints "Dinesh Bhai M. · +91 99••• ••205". Two rules, one file:
//   • THE PHONE is the 1b masking read model's own (`maskPhone`, `+91 99••• ••205`) — imported, never re-typed, because a
//     second mask is a second answer to how much of a member's number this console reveals.
//   • THE NAME is the given name(s) and the family name's initial — the canon's own shape — and a missing name is `null`,
//     which the screen prints as "name not recorded", never as the phone or the id.
export { maskPhone } from '../../identity/read-models/member-roster.read-model';

export function shortName(full: string | null | undefined): string | null {
  const parts = (full ?? '').trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(' ')} ${Array.from(last)[0]}.`;
}
