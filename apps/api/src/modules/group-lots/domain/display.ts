// modules/group-lots/domain/display.ts · PC-56 TENANT-11c · F-19 — HOW A PLEDGER IS NAMED. PURE.
//
// Canon W136 draws the pledges as "Suresh B. · +91 96••• ••402 · 18 qtl · verified · 12 Jul": a SHORT name, the 1b MASK of
// the phone, the pledged quantity, the member's KYC status and when they pledged. Before this wave `GET /group-lots/:id`
// returned every pledger's raw user id, quantity and share to ANY member. Now the coordinator of THAT lot and tenant_admin see
// the pledge table; a member sees the lot's progress and their OWN pledge. The mask is imported from the member roster read
// model, never re-typed (a second mask is a second answer to how much of a member's number this console reveals).
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

/** The roles whose KYC speaks for a pledger, in the order the pledge table reads them (a pledge is produce). */
export const PRODUCER_ROLES = ['farmer', 'pashupalak', 'dairy_farmer'] as const;

/**
 * The KYC a pledge row shows: the status on the member's first PRODUCER role (farmer → pashupalak → dairy_farmer), as 9a's
 * role projector wrote it (`user_tenant_roles.kyc_status`). A member with no producer role shows `null` + "no producer role"
 * — never a borrowed status from an unrelated role (TENANT-1 found a worker's KYC drawing a farmer's settlement).
 */
export function pledgerKyc(roles: Array<{ roleCode: string; kycStatus: string }>): { kycStatus: string | null; kycRole: string | null } {
  for (const code of PRODUCER_ROLES) {
    const r = roles.find((x) => x.roleCode === code);
    if (r) return { kycStatus: r.kycStatus, kycRole: code };
  }
  return { kycStatus: null, kycRole: null };
}

/** "86%" — whole percent of target from integer basis points (floor). */
export function percentText(bps: number): string { return `${Math.floor(bps / 100)}%`; }

/** DD/MM/YYYY HH:mm in India time — the deadline as a member reads it in a notice. */
export function indiaDateTime(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
}
