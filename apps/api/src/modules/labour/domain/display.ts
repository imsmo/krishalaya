// modules/labour/domain/display.ts · PC-56 TENANT-11b · F-19 — HOW A WORKER IS NAMED ON A ROSTER. PURE.
//
// Canon W164's roster draws "Hansa Ben V. · +91 90••• ••412": a SHORT name and a MASKED phone. Before this wave the roster
// returned worker ids and wages to any tenant member who asked. Now the employer and the labour desk see the short name and
// the 1b mask of the phone (`maskPhone`, imported from the member roster read model, never re-typed: a second mask is a
// second answer to how much of a member's number this console reveals); nobody else sees the roster at all.
export { maskPhone } from '../../identity/read-models/member-roster.read-model';

/** "Hansa Ben Vaghela" → "Hansa V."; one word → itself; blank → null (the screen says "name not recorded"). */
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

/** The India calendar day of an instant — the work date a clock-in belongs to (not the UTC day: 05:00 IST is still today). */
export function indiaDay(d: Date): string {
  const s = new Date(d.getTime() + 330 * 60_000).toISOString();
  return s.slice(0, 10);
}
