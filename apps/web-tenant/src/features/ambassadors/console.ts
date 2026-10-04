// apps/web-tenant/src/features/ambassadors/console.ts · PC-56 TENANT-10a · AMBASSADORS + REFERRALS, in the console. PURE.
//
// W159 (`/people/ambassadors`), the recruit form chain W2481–W2484 (`/people/ambassadors/new`), the edit form chain
// (`/people/ambassadors/[id]/edit`), the mutate chain W2485–W2487 (`/people/ambassadors/[id]/act` — suspend · reinstate ·
// pay out — and `/people/ambassadors/run`, the weekly earnings run), W162 (`/people/referrals`), the referral mutate chain
// W2735–W2737 (`/people/referrals/[id]/activate`) and the reward-rule form W2731–W2734 (`/people/referrals/reward-rule`),
// which is ONE state card: the rule cannot exist yet.
//
// Every list here is the API's own (the console spec reads the API source and asserts they agree); every word is a key
// (Law 7); every refusal is a sentence. Nothing here computes money: owed / paid figures are the API's minor-unit strings.
export const AMBASSADORS_HREF = '/people/ambassadors';
export const NEW_AMBASSADOR_HREF = '/people/ambassadors/new';
export const RUN_HREF = '/people/ambassadors/run';
/** PC-56 TENANT-SW-b · W161 — the run under maker-checker (features/swb/console.ts owns its helpers). */
export const EARNINGS_HREF = '/people/ambassadors/earnings';
export const REFERRALS_HREF = '/people/referrals';
export const REWARD_RULE_HREF = '/people/referrals/reward-rule';
export const MEMBERS_HREF = '/people';

/** The `ambassador_tier` lookup codes (seed core/0005), in the ladder's order — the roster's tier tabs. */
export const AMB_TIERS = ['trainee', 'ambassador', 'senior', 'cluster_lead', 'district_coordinator'] as const;
export const ROSTER_SORTS = ['recent', 'owed'] as const;
export const INACTIVE_DAYS = 60;
export const AMB_ACTS = ['suspend', 'reinstate', 'payout', 'message'] as const;
export type AmbActCode = (typeof AMB_ACTS)[number];
/** The API's recruit / edit refusals (domain/recruit.rules.ts RECRUIT_REFUSALS). */
export const RECRUIT_REFUSALS = ['PHONE_REQUIRED', 'PHONE_INVALID', 'NO_ACCOUNT', 'NOT_A_MEMBER', 'ALREADY_AMBASSADOR', 'TIER_UNKNOWN',
  'TOO_MANY_CLUSTERS', 'CLUSTER_UNKNOWN', 'CLUSTER_REPEATED', 'MENTOR_UNKNOWN', 'MENTOR_INACTIVE', 'MENTOR_SELF', 'STIPEND_INVALID', 'NOTHING_CHANGED'] as const;
export const RECRUIT_FIELDS = ['phone', 'tierId', 'clusterRegionIds', 'mentorAmbassadorId', 'kioskEnabled', 'aepsEnabled', 'monthlyStipendMinor'] as const;
export const EDIT_FIELDS = ['tierId', 'clusterRegionIds', 'mentorAmbassadorId', 'kioskEnabled', 'aepsEnabled', 'monthlyStipendMinor', 'trainingCompleted'] as const;
/** The act / transport codes a mutate or a write can fail with (the API's typed errors), each a sentence. */
export const ACT_CODES = ['REASON_REQUIRED', 'NOTHING_TO_PAYOUT', 'PAYOUT_MARK_MISMATCH', 'AMB_RUN_NOTHING_OWED', 'AMB_RUN_ALREADY_OPEN', 'AMB_MESSAGE_INVALID', 'AMBASSADOR_NOT_FOUND', 'REFERRAL_NOT_FOUND',
  'REFERRAL_ILLEGAL_TRANSITION', 'AMBASSADORS_FORBIDDEN', 'FORBIDDEN', 'AMBASSADOR_REFUSED', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'] as const;
export const REFERRAL_TABS = ['all', 'invited', 'signed_up', 'activated'] as const;
export const REFERRAL_STATUSES = ['invited', 'signed_up', 'activated', 'rewarded'] as const;

/**
 * What W159 / W162 draw that this platform cannot stand behind — each printed on the page with its reason, never hidden
 * and never faked (B · REFUSED BY NAME). `retry` is the canon's own act on the mutate chains: a page load, not a mutation.
 */
export const AMB_REFUSED_BY_NAME = ['uncoveredVillages', 'reassignment', 'exclusivity', 'training', 'fridayRun', 'retry'] as const;
export const REF_REFUSED_BY_NAME = ['rewardRule', 'rewardPaid', 'inviteePhone', 'firstTxnActivation', 'ringDetection', 'retry'] as const;
export const retryIsMutation = (): false => false;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isTier = (v: unknown) => has(AMB_TIERS, v);
export const isAmbAct = (v: unknown): v is AmbActCode => has(AMB_ACTS, v);
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/* ---------------------------------------------------------------------------------------------------------- */
/* HREFS AND THE GET-FORM FILTERS                                                                             */
/* ---------------------------------------------------------------------------------------------------------- */

export const detailHref = (id: string) => `${AMBASSADORS_HREF}/${encodeURIComponent(id)}`;
export const editHref = (id: string) => `${AMBASSADORS_HREF}/${encodeURIComponent(id)}/edit?step=edit`;
export const actHref = (id: string, act: AmbActCode) => `${AMBASSADORS_HREF}/${encodeURIComponent(id)}/act?step=confirm&act=${act}`;
export const activateHref = (id: string) => `${REFERRALS_HREF}/${encodeURIComponent(id)}/activate?step=confirm`;

export interface RosterFilters { tier?: string; inactive?: boolean; sort: 'recent' | 'owed'; cursor?: string }
/** Unknown values are NO filter, never an error and never passed through. */
export function rosterFilters(sp: Record<string, string | string[] | undefined>): RosterFilters {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).trim() : '');
  const out: RosterFilters = { sort: one('sort') === 'owed' ? 'owed' : 'recent' };
  if (isTier(one('tier'))) out.tier = one('tier');
  if (one('inactive') === '1') out.inactive = true;
  if (CURSOR.test(one('cursor'))) out.cursor = one('cursor');
  return out;
}
export function rosterHref(f: Omit<RosterFilters, 'cursor'>, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (f.tier) q.set('tier', f.tier);
  if (f.inactive) q.set('inactive', '1');
  if (f.sort === 'owed') q.set('sort', 'owed');
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${AMBASSADORS_HREF}?${s}` : AMBASSADORS_HREF;
}

export interface ReferralFilters { tab: (typeof REFERRAL_TABS)[number]; cursor?: string }
export function referralFilters(sp: Record<string, string | string[] | undefined>): ReferralFilters {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).trim() : '');
  const tab = has(REFERRAL_TABS, one('status')) ? (one('status') as ReferralFilters['tab']) : 'all';
  return CURSOR.test(one('cursor')) ? { tab, cursor: one('cursor') } : { tab };
}
export function referralHref(tab: ReferralFilters['tab'], cursor?: string | null): string {
  const q = new URLSearchParams();
  if (tab !== 'all') q.set('status', tab);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${REFERRALS_HREF}?${s}` : REFERRALS_HREF;
}
/** The API's status filter for a tab (`all` is no filter). */
export const tabStatus = (tab: ReferralFilters['tab']): string | undefined => (tab === 'all' ? undefined : tab);

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

/** The four non-content states a read can land in. The API answers a switched-off flag with 404 (invisible when off). */
export function consoleState(code: string | undefined, status?: number, list = false): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return list ? 'flaggedOff' : 'notFound';
  return 'error';
}

/** The codes a failed write carries — the API's typed refusals when it lists them, else its own code. Codes only. */
export function failureCodesFrom(details: unknown, code: string | undefined): string[] {
  const list = (details as { refusals?: unknown } | null)?.refusals;
  const fromList = Array.isArray(list) ? list.map((r) => (r as { code?: unknown })?.code).filter((c): c is string => typeof c === 'string' && /^[A-Za-z_]{2,40}$/.test(c)) : [];
  if (fromList.length) return [...new Set(fromList)];
  return [code && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown'];
}
/** A code → its sentence key. Recruit refusals and act codes share one namespace; an unknown code is `unknown`. */
export function codeKey(code: string): string {
  return has(RECRUIT_REFUSALS, code) || has(ACT_CODES, code) ? `amb.code.${code}` : 'amb.code.unknown';
}

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT A ROW SAYS                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

/** The acts a roster row offers: suspend or reinstate; pay out (PC-56 TENANT-SW-b: PREPARE a one-ambassador exception run, which a
 *  second tenant admin confirms) only for an active ambassador who is owed something; message (W160 "Message") an active one. */
export function actsFor(row: { isActive: boolean; owedMinor: string }): AmbActCode[] {
  const owed = /^\d+$/.test(row.owedMinor) && BigInt(row.owedMinor) > 0n;
  return row.isActive ? (owed ? ['suspend', 'payout', 'message'] : ['suspend', 'message']) : ['reinstate'];
}

/** "Last active" in words. `null` = no act was ever recorded (the writer exists since TENANT-10a). */
export function lastActive(iso: string | null, nowMs: number): { key: string; vars: Record<string, string> } {
  if (!iso) return { key: 'amb.lastActive.never', vars: {} };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { key: 'amb.lastActive.never', vars: {} };
  const days = Math.max(0, Math.floor((nowMs - t) / 86_400_000));
  if (days === 0) return { key: 'amb.lastActive.today', vars: {} };
  if (days === 1) return { key: 'amb.lastActive.yesterday', vars: {} };
  return { key: days >= INACTIVE_DAYS ? 'amb.lastActive.inactive' : 'amb.lastActive.daysAgo', vars: { n: String(days) } };
}

/** The person as this console names them — short name, else "name not recorded" — plus the masked phone. */
export function personKey(displayName: string | null): { key: string; vars: Record<string, string> } {
  return displayName ? { key: 'amb.person.named', vars: { name: displayName } } : { key: 'amb.person.unnamed', vars: {} };
}

export const tierKey = (code: string | null) => (code && isTier(code) ? `amb.tier.${code}` : 'amb.tier.none');
export const statusKey = (s: string) => (has(REFERRAL_STATUSES, s) ? `ref.status.${s}` : 'ref.status.unknown');
export const fieldKey = (form: 'recruit' | 'edit', name: string) => `amb.${form}.field.${name}`;
export const actKey = (act: AmbActCode) => `amb.act.${act}`;

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FORM CHAINS — entries in the URL                                                                        */
/* ---------------------------------------------------------------------------------------------------------- */

export interface FormEntries {
  phone?: string; tierId?: string; clusterRegionIds?: string[]; mentorAmbassadorId?: string;
  kioskEnabled?: boolean; aepsEnabled?: boolean; monthlyStipendMinor?: string; trainingCompleted?: boolean;
}
/** Up to three cluster regions travel as `c1`, `c2`, `c3` (each a select), so a no-JS form can carry them. */
export const CLUSTER_SLOTS = ['c1', 'c2', 'c3'] as const;
export const MAX_CARRIED_AMB = 1500;

/** Rupees as typed → paise as a string (integer arithmetic on the digits; never a float). `null` = not a valid amount. */
export function rupeesToMinor(raw: string | undefined): string | null {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (s === '') return '0';
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return (BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0')).toString();
}
export function minorToRupees(minor: string | null | undefined): string {
  if (!minor || !/^\d+$/.test(minor)) return '';
  const v = BigInt(minor); const r = v / 100n; const p = v % 100n;
  return p === 0n ? r.toString() : `${r}.${p.toString().padStart(2, '0')}`;
}

/** Read the entries back out of the URL (the chain's "values you entered are preserved"). */
export function formEntries(sp: Record<string, string | string[] | undefined>, withPhone: boolean): { entries: FormEntries; stipendInvalid: boolean } {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).trim() : '');
  const e: FormEntries = {};
  if (withPhone && one('phone')) e.phone = one('phone').slice(0, 20);
  const submitted = one('clustersTouched') === '1';   // the form was submitted: an empty select means "none", not "unchanged"
  if (one('tierId') || submitted) e.tierId = one('tierId').slice(0, 80);
  const clusters = CLUSTER_SLOTS.map(one).filter((x) => x.length > 0).map((x) => x.slice(0, 80));
  if (clusters.length || submitted) e.clusterRegionIds = clusters;
  if (one('mentorAmbassadorId') || submitted) e.mentorAmbassadorId = one('mentorAmbassadorId').slice(0, 80);
  if (one('kiosk') !== '') e.kioskEnabled = one('kiosk') === '1';
  if (one('aeps') !== '') e.aepsEnabled = one('aeps') === '1';
  if (one('training') === '1') e.trainingCompleted = true;
  const stipend = rupeesToMinor(one('stipend') || undefined);
  if (one('stipend') !== '' && stipend !== null) e.monthlyStipendMinor = stipend;
  return { entries: e, stipendInvalid: one('stipend') !== '' && stipend === null };
}
/** The flat values a chain href carries (the inverse of `formEntries`). */
export function carriedFrom(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['phone', 'tierId', 'c1', 'c2', 'c3', 'mentorAmbassadorId', 'kiosk', 'aeps', 'stipend', 'training', 'clustersTouched', 'reason']) {
    const v = sp[k];
    if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim().slice(0, 300);
  }
  return out;
}

/** A server action's FormData → the same record `formEntries` reads (the hidden fields carry the URL's values). */
export function recordFromForm(get: (k: string) => FormDataEntryValue | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['phone', 'tierId', 'c1', 'c2', 'c3', 'mentorAmbassadorId', 'kiosk', 'aeps', 'stipend', 'training', 'clustersTouched', 'reason']) {
    const v = get(k);
    if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim().slice(0, 300);
  }
  return out;
}
