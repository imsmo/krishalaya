// @krishalaya/sdk-js · the PEOPLE roster (W153) and one member's detail (W154). PC-56 TENANT-1b.
//
// **NOT `memberships`.** That resource is PC-28's paid membership-TIER manager (tiers, fees, subscribe) and shares only
// a word with this one. This is the register of PEOPLE in an organisation: 1,284 farmers, pashupalaks and workers, each
// with one or more roles and a KYC status PER ROLE.
//
// **EVERY PHONE NUMBER THIS RESOURCE RETURNS IS MASKED, INCLUDING ON THE DETAIL READ.** Unmasking is `revealField` — a
// POST, one field at a time, with a reason, recorded in the audit log before the value comes back. There is no bulk
// reveal and there will not be one: that is what keeps the trail readable and exfiltration expensive.
import { HttpClient } from '../http';

export interface RosterRole { roleCode: string; kycStatus: string; isActive: boolean }

export interface RosterMember {
  userId: string;
  fullName: string | null;
  /** Always masked, e.g. `+91 96••• ••114`. */
  phoneMasked: string;
  villageName: string | null;
  languageCode: string;
  roles: RosterRole[];
  lastActiveAt: string | null;
  /** Money RECEIVED through this tenant (settled payouts), minor units as a string (Law 2). */
  lifetimeReceivedMinor: string;
}

export interface RosterCensus {
  activeMembers: number;
  fullyVerified: number;
  activeLast30d: number;
  dormant: number;
  /** **Always null.** Nothing on this platform records input modality, so W153's "voice-first · 64%" has no source. */
  voiceFirstShare: number | null;
}

export interface RosterQuery {
  /** Name or phone. Trigram-indexed, so a Gujarati spelling variant is findable. */
  q?: string;
  roleCode?: string;
  kycStatus?: string;
  dormantDays?: number;
  cursor?: string;
  limit?: number;
}

export interface MemberRoleDetail extends RosterRole {
  since: string | null;
  documents: { docType: string; status: string; validUntil: string | null }[];
}

export interface MemberGlance {
  lifetimeReceivedMinor: string;
  paidPayoutCount: number;
  sellerOrderCount: number;
  firstSellerOrderAt: string | null;
  /** null when this tenant runs no dairy for the member — which is not the same as zero litres. */
  dairy: { litres: string; amountMinor: string; avgFatPct: string; avgSnfPct: string; animalCount: number } | null;
  disputesAgainst: number;
  disputesAgainstUpheld: number;
  disputesOpen: number;
  /** **Always null** — there is no trust score on this platform. The dispute counts above are the real record. */
  trustScore: null;
  /** **Always null** — the only per-day activity trail (`login_events`) is platform-wide, so a tenant console must not
   *  count it: it would expose how often the member used a DIFFERENT organisation's app. */
  activeDays30d: null;
}

export interface MemberPreferences {
  languageCode: string;
  quietHours: { starts: string; ends: string; timezone: string } | null;
  priceAlerts: { productName: string | null; direction: string; thresholdMinor: string; isActive: boolean }[];
  mutedEvents: { eventCode: string; channel: string }[];
}

export interface MemberActivityItem {
  kind: 'payout' | 'listing';
  at: string;
  amountMinor: string | null;
  label: string;
  status: string;
}

export interface MemberDetail {
  userId: string;
  fullName: string | null;
  platformStatus: string;
  phoneMasked: string;
  villageName: string | null;
  languageCode: string;
  memberSince: string | null;
  lastActiveAt: string | null;
  aadhaarLast4: string | null;
  hasAadhaarVault: boolean;
  hasPanVault: boolean;
  /** No ACTIVE role in this tenant. The record still reads — membership history stays with the member. */
  membershipInactive: boolean;
  roles: MemberRoleDetail[];
  glance: MemberGlance;
  preferences: MemberPreferences;
  activity: MemberActivityItem[];
}

/** The only fields that may ever be unmasked. A closed list server-side too — the vault refs are not on it. */
export const REVEALABLE_MEMBER_FIELDS = ['phone', 'email', 'aadhaar_last4'] as const;
export type RevealableMemberField = (typeof REVEALABLE_MEMBER_FIELDS)[number];

/* ------------------------------------------------------------------------------------------------------------ */
/* THE WORST-STATUS READING — W153's KYC COLUMN                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */
/**
 * **THIS ORDER IS THE SECOND COPY IN THE MONOREPO AND THAT IS DISCLOSED, NOT HIDDEN (TENANT-1b-Q5).** The first lives in
 * `apps/api/src/modules/payments/domain/payout-kyc.ts`, where it gates money. No package is imported by BOTH `apps/api`
 * and the six consoles, so sharing it needs a new workspace dependency and a lockfile change — which cannot happen in a
 * code-only wave. The order is reproduced with its reasoning so a future reader fixing one knows the other exists.
 *
 * The reasoning, unchanged: "lowest" has to be an explicit total order rather than a string sort. Alphabetically
 * `expired` precedes `pending` precedes `verified`, which would rank an EXPIRED verification as worse than a REJECTED
 * one. It is not — a rejection is a decision against the person, an expiry is a clock running out — and a roster that
 * ranked them the other way round would send staff to the wrong member first.
 */
const KYC_SEVERITY: Record<string, number> = {
  rejected: 0,   // somebody looked and said no
  none: 1,       // never started
  expired: 2,    // was verified once; a re-check, not a rejection
  pending: 3,    // in flight
  verified: 4,   // done
};

/** An unrecognised status sorts as the WORST: a state this code cannot describe is a state whose safety it cannot assert. */
export function kycSeverity(status: string): number {
  return KYC_SEVERITY[status] ?? -1;
}

/** Every ACTIVE role verified — not merely one. This is what W153's "Fully verified members · 89%" counts. */
export function isFullyVerified(roles: RosterRole[]): boolean {
  const active = roles.filter((r) => r.isActive);
  return active.length > 0 && active.every((r) => r.kycStatus === 'verified');
}

export interface KycLabel {
  /** An i18n KEY, never a sentence: `noRoles` | `verifiedOne` | `verifiedMany` | `mixed`. */
  key: 'noRoles' | 'verifiedOne' | 'verifiedMany' | 'mixed';
  count: number;
  status: string;
  /** The role the label turned on — the one somebody has to act on. */
  roleCode: string | null;
}

/**
 * The roster cell for a member: "verified ×2", or the WORST status when their roles disagree.
 *
 * W153 renders both shapes and the difference is the whole point of the column: Ramesh P. is `verified ×2`, Kanji Bhai R.
 * is `worker: verified / farmer: pending` — and the money gate this platform fixed in TENANT-1 turns on exactly that
 * distinction. A mixed member is labelled by the role that is BEHIND.
 */
export function rosterKycLabel(roles: RosterRole[]): KycLabel {
  const active = roles.filter((r) => r.isActive);
  if (active.length === 0) return { key: 'noRoles', count: 0, status: 'none', roleCode: null };
  if (isFullyVerified(active)) {
    return { key: active.length > 1 ? 'verifiedMany' : 'verifiedOne', count: active.length, status: 'verified', roleCode: null };
  }
  const worst = active.reduce((a, b) => (kycSeverity(b.kycStatus) < kycSeverity(a.kycStatus) ? b : a));
  return { key: 'mixed', count: active.length, status: worst.kycStatus, roleCode: worst.roleCode };
}

export class MembersResource {
  constructor(private readonly http: HttpClient) {}

  /** One keyset page of the people roster, plus the census tiles. Needs `report.view`. */
  async roster(params: RosterQuery = {}, signal?: AbortSignal): Promise<{ items: RosterMember[]; census: RosterCensus; nextCursor: string | null }> {
    const r = await this.http.request<RosterMember[]>('GET', 'members/roster', {
      query: { q: params.q, roleCode: params.roleCode, kycStatus: params.kycStatus, dormantDays: params.dormantDays, cursor: params.cursor, limit: params.limit ?? 25 },
      signal,
    });
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    return {
      items: r.data,
      census: {
        activeMembers: Number(meta.activeMembers ?? 0),
        fullyVerified: Number(meta.fullyVerified ?? 0),
        activeLast30d: Number(meta.activeLast30d ?? 0),
        dormant: Number(meta.dormant ?? 0),
        voiceFirstShare: (meta.voiceFirstShare as number | null) ?? null,
      },
      nextCursor: (meta.nextCursor as string | null) ?? null,
    };
  }

  /** One member's full record (W154). Needs `report.view`; 404 for somebody who is not a member of this tenant. */
  async get(userId: string, signal?: AbortSignal): Promise<MemberDetail> {
    return (await this.http.request<MemberDetail>('GET', `members/roster/${encodeURIComponent(userId)}`, { signal })).data;
  }

  /**
   * Unmask ONE field of ONE member, with a reason of at least 20 characters.
   *
   * **THE REASON IS NOT A FORMALITY AND THE SERVER ENFORCES ITS LENGTH.** It is stored on the audit row that is written
   * BEFORE the value is returned — if the record cannot be written the reveal does not happen. Needs
   * `member.pii.reveal`, which is a separate grant from reading the roster.
   */
  async revealField(userId: string, field: RevealableMemberField, reason: string): Promise<{ field: RevealableMemberField; value: string | null }> {
    return (await this.http.request<{ field: RevealableMemberField; value: string | null }>(
      'POST', `members/roster/${encodeURIComponent(userId)}/reveal`, { body: { field, reason } })).data;
  }
}
