// modules/ambassadors/domain/recruit.rules.ts · PC-56 TENANT-10a · W2481–W2484 (Recruit ambassador) and the Edit chain. PURE.
//
// ONE FUNCTION ANSWERS "CAN THIS BE WRITTEN, AND IF NOT, WHY" — for the review step (W2482, and with refusals it IS
// W2481's form-error) AND for the act itself, which re-gathers the facts inside its own transaction and re-asks. A review
// that reports `ready` therefore cannot be followed by a failure for a reason the review could have named.
//
// THE MEMBER IS PICKED BY PHONE, NEVER BY A PASTED UUID (F-16). The console used to enrol "user UUID" typed into a box; a
// recruit is an EXISTING member of this cooperative, found by the phone number staff actually have, and the screen shows
// that member's name and MASKED phone before anything is written.

export const RECRUIT_FIELDS = ['phone', 'tierId', 'clusterRegionIds', 'mentorAmbassadorId', 'kioskEnabled', 'aepsEnabled', 'monthlyStipendMinor'] as const;
export const EDIT_FIELDS = ['tierId', 'clusterRegionIds', 'mentorAmbassadorId', 'kioskEnabled', 'aepsEnabled', 'monthlyStipendMinor', 'trainingCompleted'] as const;
export const MAX_CLUSTERS = 3;

export const RECRUIT_REFUSALS = ['PHONE_REQUIRED', 'PHONE_INVALID', 'NO_ACCOUNT', 'NOT_A_MEMBER', 'ALREADY_AMBASSADOR', 'TIER_UNKNOWN',
  'TOO_MANY_CLUSTERS', 'CLUSTER_UNKNOWN', 'CLUSTER_REPEATED', 'MENTOR_UNKNOWN', 'MENTOR_INACTIVE', 'MENTOR_SELF', 'STIPEND_INVALID', 'NOTHING_CHANGED'] as const;
export type RecruitRefusalCode = (typeof RECRUIT_REFUSALS)[number];
export interface Refusal { field: string | null; code: RecruitRefusalCode }

/** What the form sent, every entry an optional string (a review must answer a mistyped value, not 400 on it). */
export interface RecruitEntries {
  phone?: string; tierId?: string; clusterRegionIds?: string[]; mentorAmbassadorId?: string;
  kioskEnabled?: boolean; aepsEnabled?: boolean; monthlyStipendMinor?: string;
}
export interface EditEntries extends Omit<RecruitEntries, 'phone'> { trainingCompleted?: boolean }

/** The facts the service gathered (in the act's own transaction, or from the replica for a review). */
export interface RecruitFacts {
  phoneE164: string | null;
  member: { userId: string; isMember: boolean } | null;
  alreadyAmbassador: boolean;
  tierKnown: boolean | null;          // null = no tier entered
  unknownClusterIds: string[];
  mentor: { exists: boolean; active: boolean; userId: string | null } | null;   // null = no mentor entered
}

const MINOR = /^\d{1,15}$/;

function clusterRefusals(ids: string[] | undefined, unknown: string[]): Refusal[] {
  const out: Refusal[] = [];
  const list = ids ?? [];
  if (list.length > MAX_CLUSTERS) out.push({ field: 'clusterRegionIds', code: 'TOO_MANY_CLUSTERS' });
  if (new Set(list).size !== list.length) out.push({ field: 'clusterRegionIds', code: 'CLUSTER_REPEATED' });
  if (unknown.length > 0) out.push({ field: 'clusterRegionIds', code: 'CLUSTER_UNKNOWN' });
  return out;
}
function commonRefusals(e: EditEntries, f: Pick<RecruitFacts, 'tierKnown' | 'unknownClusterIds' | 'mentor'>, selfUserId: string | null): Refusal[] {
  const out: Refusal[] = [];
  if (f.tierKnown === false) out.push({ field: 'tierId', code: 'TIER_UNKNOWN' });
  out.push(...clusterRefusals(e.clusterRegionIds, f.unknownClusterIds));
  if (f.mentor) {
    if (!f.mentor.exists) out.push({ field: 'mentorAmbassadorId', code: 'MENTOR_UNKNOWN' });
    else if (!f.mentor.active) out.push({ field: 'mentorAmbassadorId', code: 'MENTOR_INACTIVE' });
    else if (selfUserId && f.mentor.userId === selfUserId) out.push({ field: 'mentorAmbassadorId', code: 'MENTOR_SELF' });
  }
  if (e.monthlyStipendMinor !== undefined && e.monthlyStipendMinor !== '' && !MINOR.test(e.monthlyStipendMinor)) out.push({ field: 'monthlyStipendMinor', code: 'STIPEND_INVALID' });
  return out;
}

/** Every reason a recruit would be refused — every, not the first (W2481: "every invalid field is listed"). */
export function recruitRefusals(e: RecruitEntries, f: RecruitFacts): Refusal[] {
  const out: Refusal[] = [];
  if (!e.phone || e.phone.trim() === '') out.push({ field: 'phone', code: 'PHONE_REQUIRED' });
  else if (!f.phoneE164) out.push({ field: 'phone', code: 'PHONE_INVALID' });
  else if (!f.member) out.push({ field: 'phone', code: 'NO_ACCOUNT' });
  else if (!f.member.isMember) out.push({ field: 'phone', code: 'NOT_A_MEMBER' });
  else if (f.alreadyAmbassador) out.push({ field: 'phone', code: 'ALREADY_AMBASSADOR' });
  out.push(...commonRefusals(e, f, f.member?.userId ?? null));
  return out;
}

/** The edit's refusals, against the profile as it stands (`current`) — an edit that changes nothing is refused by name. */
export function editRefusals(e: EditEntries, f: Pick<RecruitFacts, 'tierKnown' | 'unknownClusterIds' | 'mentor'>, selfUserId: string, diff: EditDiffLine[]): Refusal[] {
  const out = commonRefusals(e, f, selfUserId);
  if (out.length === 0 && diff.length === 0) out.push({ field: null, code: 'NOTHING_CHANGED' });
  return out;
}

export interface EditDiffLine { field: string; before: string | null; after: string | null }

/** W2482's "diff against current values where applicable" — only the fields the edit actually changes. */
export function editDiff(current: Record<string, unknown>, e: EditEntries): EditDiffLine[] {
  const s = (v: unknown): string | null => (v === null || v === undefined ? null : Array.isArray(v) ? v.join(',') : String(v));
  const lines: EditDiffLine[] = [];
  const cmp = (field: string, before: unknown, after: unknown) => { if (after !== undefined && s(before) !== s(after)) lines.push({ field, before: s(before), after: s(after) }); };
  cmp('tierId', current.tierId, e.tierId === '' ? null : e.tierId);
  if (e.clusterRegionIds !== undefined) cmp('clusterRegionIds', [...((current.clusterRegionIds as string[]) ?? [])].sort(), [...e.clusterRegionIds].sort());
  cmp('mentorAmbassadorId', current.mentorAmbassadorId, e.mentorAmbassadorId === '' ? null : e.mentorAmbassadorId);
  cmp('kioskEnabled', current.kioskEnabled, e.kioskEnabled);
  cmp('aepsEnabled', current.aepsEnabled, e.aepsEnabled);
  cmp('monthlyStipendMinor', current.monthlyStipendMinor, e.monthlyStipendMinor === '' ? undefined : e.monthlyStipendMinor);
  if (e.trainingCompleted === true && !current.trainingCompletedAt) lines.push({ field: 'trainingCompleted', before: null, after: 'true' });
  return lines;
}
