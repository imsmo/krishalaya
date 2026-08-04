// apps/mobile/src/features/tenant/tenant-admin.ts · PURE tenant-admin-lite logic for P-17. No React/native (SDK/ui
// types are `import type` → erased) → unit-tested. THE APP IS NOT GOD-MODE (Law 11): a tenant admin only acts
// within their own tenant and every action is authorized + re-checked SERVER-SIDE; these helpers only drive the
// UI (status tones, KPI counts from real lists, resolution options, add-farmer validation). Money is bigint
// minor strings (Law 2) — never floated here.
import type { PillTone } from '@krishalaya/ui-native';
import type { RoleAssignment, Dispute, Subscription, Plan } from '@krishalaya/sdk-js';

/** The farmer cap for a plan from its real `limits` map (key 'farmers' | 'max_farmers'), or null when the plan is
 * uncapped / the limit isn't published. Pure — never fabricates a cap (§13). Drives the "Up to N farmers" line. */
export function planFarmerLimit(plan: Pick<Plan, 'limits'>): number | null {
  const raw = plan.limits?.farmers ?? plan.limits?.max_farmers;
  if (raw == null) return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The estimated "expected response by" time = submission time + the stated review SLA hours (default 24).
 * Derived from the REAL createdAt + the product's published SLA — never a fabricated date. null if unparseable. */
export function expectedResponseAt(createdAtIso: string | null | undefined, slaHours = 24): string | null {
  if (!createdAtIso) return null;
  const t = Date.parse(createdAtIso);
  if (Number.isNaN(t)) return null;
  return new Date(t + slaHours * 3_600_000).toISOString();
}

/** Plans ordered by real monthly price ascending (bigint-safe compare — Law 2). Pure; does not mutate input. */
export function sortPlansByPrice(plans: readonly Plan[] | null | undefined): Plan[] {
  return [...(plans ?? [])].sort((a, b) => {
    try { const d = BigInt(a.monthlyPriceMinor) - BigInt(b.monthlyPriceMinor); return d < 0n ? -1 : d > 0n ? 1 : 0; }
    catch { return 0; }
  });
}

/** A plan's capability lines from its REAL `limits` map (billing screen). `-1` (or `0`) = uncapped → the screen
 * shows "Unlimited"; any other value is the real cap. Sorted by key for a stable list. Never fabricates a bullet
 * the plan doesn't publish — the mockup's marketing lines (branding/support/API) are NOT on the contract (§13). */
export interface PlanLimitLine { key: string; value: string; unlimited: boolean }
export function planLimitLines(plan: Pick<Plan, 'limits'> | null | undefined): PlanLimitLine[] {
  const limits = plan?.limits ?? {};
  return Object.keys(limits).sort().map((key) => {
    const raw = String(limits[key] ?? '').trim();
    const unlimited = raw === '-1' || raw === '0' || raw === '';
    return { key, value: raw, unlimited };
  });
}

export interface UsageRow { key: string; used: number; limit: number | null; pct: number | null }
/** The "usage this month" rows from the REAL {limits, usage} maps the subscription dashboard returns. `limit`
 * is null when uncapped (-1/0). `pct` is used/limit clamped to 0..1, or null when uncapped/unknown — the bar hides.
 * All values are integers (counts), never money. Never fabricates a usage number. */
export function usageRows(limits: Record<string, string> | undefined, usage: Record<string, string> | undefined): UsageRow[] {
  const lim = limits ?? {}; const use = usage ?? {};
  const keys = Array.from(new Set([...Object.keys(use), ...Object.keys(lim)])).sort();
  return keys.map((key) => {
    const used = toInt(use[key]);
    const rawLimit = toInt(lim[key]);
    const limit = rawLimit !== null && rawLimit > 0 ? rawLimit : null; // -1/0/absent = uncapped
    const pct = limit && used !== null ? Math.max(0, Math.min(1, used / limit)) : null;
    return { key, used: used ?? 0, limit, pct };
  });
}
function toInt(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

/** A plan is a "contact us / custom" tier when it publishes no monthly price (0). Drives the Enterprise card. */
export function isCustomPlan(plan: Pick<Plan, 'monthlyPriceMinor'>): boolean {
  const raw = String(plan.monthlyPriceMinor ?? '').trim();
  return raw === '' || raw === '0';
}

/** The upgrade options for the billing screen: public+active plans OTHER than the current one, priced ABOVE the
 * current subscription (bigint-safe) OR custom (price 0 = contact-us). Sorted by price ascending, custom last.
 * Real catalogue — never invents a tier. */
export function upgradePlans(plans: readonly Plan[] | null | undefined, currentPlanId: string | null | undefined, currentPriceMinor: string | null | undefined): Plan[] {
  let cur: bigint; try { cur = BigInt(currentPriceMinor ?? '0'); } catch { cur = 0n; }
  const out = (plans ?? []).filter((p) => {
    if (p.id === currentPlanId) return false;
    if (p.isPublic === false || p.isActive === false) return false;
    if (isCustomPlan(p)) return true;
    try { return BigInt(p.monthlyPriceMinor) > cur; } catch { return false; }
  });
  return out.sort((a, b) => {
    const ac = isCustomPlan(a), bc = isCustomPlan(b);
    if (ac !== bc) return ac ? 1 : -1; // custom last
    try { const d = BigInt(a.monthlyPriceMinor) - BigInt(b.monthlyPriceMinor); return d < 0n ? -1 : d > 0n ? 1 : 0; } catch { return 0; }
  });
}

/** Subscription status → tone (drives apply/pending UX). */
export function subscriptionTone(status: string | undefined): PillTone {
  switch (status) {
    case 'active': return 'success';
    case 'trialing': case 'pending': return 'warning';
    case 'past_due': return 'danger';
    case 'cancelled': case 'expired': return 'neutral';
    default: return 'neutral';
  }
}

/** Whether the tenant still needs to apply / is awaiting activation (drives 06 apply vs 07 pending). */
export function needsToApply(sub: Pick<Subscription, 'status'> | null): boolean {
  return !sub;
}
export function isPending(sub: Pick<Subscription, 'status'> | null): boolean {
  return !!sub && (sub.status === 'pending' || sub.status === 'trialing');
}

/** A role assignment is awaiting approval when it isn't active and has no approval timestamp. */
export function isPendingApproval(a: Pick<RoleAssignment, 'isActive' | 'approvedAt'>): boolean {
  return !a.isActive && !a.approvedAt;
}

/** KYC/approval status → tone. */
export function approvalStatusTone(status: string): PillTone {
  switch (status) {
    case 'verified': case 'approved': case 'active': return 'success';
    case 'pending': case 'none': return 'warning';
    case 'rejected': case 'expired': return 'danger';
    default: return 'neutral';
  }
}

/** Dispute status → tone (moderation view). */
export function disputeStatusTone(status: string): PillTone {
  switch (status) {
    case 'resolved': case 'closed': return 'success';
    case 'under_review': case 'escalated': return 'accent';
    case 'open': case 'awaiting_seller': return 'warning';
    case 'rejected': case 'withdrawn': return 'neutral';
    default: return 'neutral';
  }
}

/** Dispute inbox tabs (155): the design's Open / In review / Resolved buckets over the real status enum. */
export type DisputeTab = 'open' | 'review' | 'resolved';
export function disputeTab(status: string): DisputeTab | 'other' {
  switch (status) {
    case 'open': case 'awaiting_seller': return 'open';
    case 'under_review': case 'escalated': return 'review';
    case 'resolved': case 'closed': return 'resolved';
    default: return 'other'; // rejected / withdrawn — not shown in the 3 tabs
  }
}
/** Live per-tab counts from the loaded page (real data — NOT a fabricated total like the mockup's 142). */
export function disputeTabCounts(list: readonly Pick<Dispute, 'status'>[] | null | undefined): Record<DisputeTab, number> {
  const c: Record<DisputeTab, number> = { open: 0, review: 0, resolved: 0 };
  for (const d of list ?? []) { const t = disputeTab(d.status); if (t !== 'other') c[t] += 1; }
  return c;
}
/** Disputes in the selected tab (pure). */
export function filterDisputesByTab<T extends Pick<Dispute, 'status'>>(list: readonly T[] | null | undefined, tab: DisputeTab): T[] {
  return (list ?? []).filter((d) => disputeTab(d.status) === tab);
}
/** Whole days between an ISO timestamp and now (≥0), or null if missing/unparseable. Drives the "N days ago" line. */
export function daysAgo(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}
/** Urgent = a non-resolved dispute whose real SLA due-time is breached or within 24h. Derived from slaDueAt —
 * NEVER a fabricated "URGENT" flag. Resolved/closed are never urgent; missing SLA → not urgent. */
export function isDisputeUrgent(slaDueAt: string | null | undefined, status: string, now: number = Date.now()): boolean {
  if (disputeTab(status) === 'resolved') return false;
  if (!slaDueAt) return false;
  const t = Date.parse(slaDueAt);
  if (Number.isNaN(t)) return false;
  return t - now <= 86_400_000;
}

/** Who authored a dispute message (156) — derived by matching the author id against the dispute's parties.
 * complainant = raisedBy, respondent = againstUser, else moderator (a tenant admin / KV staff). Pure. */
export type DisputeMsgRole = 'complainant' | 'respondent' | 'moderator';
export function disputeMessageRole(authorUserId: string, dispute: Pick<Dispute, 'raisedBy' | 'againstUser'>): DisputeMsgRole {
  if (authorUserId && authorUserId === dispute.raisedBy) return 'complainant';
  if (authorUserId && authorUserId === dispute.againstUser) return 'respondent';
  return 'moderator';
}

export type DisputeAction = 'review' | 'escalate' | 'resolve';
/** Which moderator actions apply to a dispute status (server re-checks legality). */
export function disputeActions(status: string): DisputeAction[] {
  switch (status) {
    case 'open': case 'awaiting_seller': return ['review'];
    case 'under_review': return ['escalate', 'resolve'];
    case 'escalated': return ['resolve'];
    default: return []; // resolved/closed/withdrawn — terminal
  }
}

/** The resolution choices a moderator can pick (UI list; the server validates the enum). */
export const RESOLUTION_OPTIONS = ['refund_full', 'refund_partial', 'replace', 'reject'] as const;
export type ResolutionOption = (typeof RESOLUTION_OPTIONS)[number];
// Single-shape result (not a discriminated union — so consumers narrow on `ok` without union-member access
// errors under tsc --noResolve): when ok, `body` is set; when not, `reason` is set.
export interface ResolutionResult { ok: boolean; body?: { resolutionType: string; resolutionAmountMinor?: string }; reason?: 'type' | 'amount' }
/** A partial refund requires an amount; others must NOT carry one. Returns the body or an error reason. */
export function buildResolution(type: string, rupees: string): ResolutionResult {
  if (!(RESOLUTION_OPTIONS as readonly string[]).includes(type)) return { ok: false, reason: 'type' };
  if (type === 'refund_partial') {
    const clean = (rupees ?? '').trim();
    if (!/^\d{1,13}$/.test(clean) || clean === '0') return { ok: false, reason: 'amount' };
    return { ok: true, body: { resolutionType: type, resolutionAmountMinor: (BigInt(clean) * 100n).toString() } };
  }
  return { ok: true, body: { resolutionType: type } };
}

export interface TenantKpis { farmers: number; pendingApprovals: number; openDisputes: number }
/** Compose dashboard KPIs from real lists the screen already fetched (no fabricated metrics endpoint). */
export function dashboardKpis(args: { assignments: RoleAssignment[]; disputes: Dispute[] }): TenantKpis {
  const farmers = (args.assignments ?? []).filter((a) => a.isActive).length;
  const pendingApprovals = (args.assignments ?? []).filter(isPendingApproval).length;
  const openDisputes = (args.disputes ?? []).filter((d) => !['resolved', 'closed', 'withdrawn', 'rejected'].includes(d.status)).length;
  return { farmers, pendingApprovals, openDisputes };
}

/** Average order value in MINOR units = gmvMinor / orders, floored (bigint-safe, Law 2). "0" when no orders. */
export function avgOrderMinor(gmvMinor: string | null | undefined, orders: number): string {
  if (!gmvMinor || !Number.isFinite(orders) || orders <= 0) return '0';
  try { return (BigInt(gmvMinor) / BigInt(Math.trunc(orders))).toString(); } catch { return '0'; }
}

export type GmvWindow = '7d' | '30d' | '3mo' | '1yr' | 'all';
const WINDOW_DAYS: Record<Exclude<GmvWindow, 'all'>, number> = { '7d': 7, '30d': 30, '3mo': 90, '1yr': 365 };
/** Map a GMV window tab to an ISO {from,to} range for the analytics read (all → open range = server default). */
export function windowRange(win: GmvWindow, nowMs: number): { from?: string; to?: string } {
  if (win === 'all') return {};
  const to = new Date(nowMs).toISOString();
  const from = new Date(nowMs - WINDOW_DAYS[win] * 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

export interface RoleGroup { roleCode: string; items: RoleAssignment[] }
/** Group the tenant roster by roleCode for the Team screen — real counts + membership rows, no fabricated names.
 * Groups are ordered by first appearance so the list is stable across reads. */
export function groupAssignmentsByRole(assignments: readonly RoleAssignment[] | null | undefined): RoleGroup[] {
  const order: string[] = [];
  const map = new Map<string, RoleAssignment[]>();
  for (const a of assignments ?? []) {
    if (!map.has(a.roleCode)) { map.set(a.roleCode, []); order.push(a.roleCode); }
    map.get(a.roleCode)!.push(a);
  }
  return order.map((roleCode) => ({ roleCode, items: map.get(roleCode)! }));
}

export type RosterTab = 'all' | 'active' | 'pending_kyc' | 'inactive';
export interface RosterCounts { all: number; active: number; pendingKyc: number; inactive: number }
/** Counts for the farmers-roster stat pills + filter chips — all from the REAL assignment list (no fabricated
 * metrics). Note: a genuine "active in last 7 days" recency metric is NOT on the RoleAssignment contract, so the
 * screen uses membership-`active` here and must not print a "7d"/"30d" recency it cannot compute. */
export function rosterCounts(assignments: readonly RoleAssignment[] | null | undefined): RosterCounts {
  const list = assignments ?? [];
  return {
    all: list.length,
    active: list.filter((a) => a.isActive).length,
    pendingKyc: list.filter((a) => a.kycStatus === 'pending').length,
    inactive: list.filter((a) => !a.isActive).length,
  };
}
/** Filter the roster to the selected tab (pure). */
export function filterRoster(assignments: readonly RoleAssignment[] | null | undefined, tab: RosterTab): RoleAssignment[] {
  const list = [...(assignments ?? [])];
  switch (tab) {
    case 'active': return list.filter((a) => a.isActive);
    case 'pending_kyc': return list.filter((a) => a.kycStatus === 'pending');
    case 'inactive': return list.filter((a) => !a.isActive);
    default: return list;
  }
}

/** Integer percentage of `count` out of `total` (0..100), clamped; 0 when total ≤ 0. Drives the roster segment
 * "N · X%" labels from REAL counts — never a fabricated share. */
export function pctOf(count: number, total: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((count / total) * 100)));
}

export type ApprovalTab = 'all' | 'verified' | 'pending';
export interface ApprovalCounts { all: number; verified: number; pending: number }
const VERIFIED_KYC = ['verified', 'approved'];
/** Counts for the approval-queue tabs from the REAL pending assignments: total, KYC-verified (ready to approve),
 * and still-pending-KYC. Note (§13): the design also splits by SOURCE (ambassador-referred vs self-signup), but
 * RoleAssignment carries no source field — so this screen tabs by the KYC status it CAN compute, never a faked
 * source split. */
export function approvalCounts(assignments: readonly RoleAssignment[] | null | undefined): ApprovalCounts {
  const list = assignments ?? [];
  const verified = list.filter((a) => VERIFIED_KYC.includes(a.kycStatus)).length;
  return { all: list.length, verified, pending: list.length - verified };
}
/** Filter the approval queue to the selected KYC tab (pure). */
export function filterApprovals(assignments: readonly RoleAssignment[] | null | undefined, tab: ApprovalTab): RoleAssignment[] {
  const list = [...(assignments ?? [])];
  if (tab === 'verified') return list.filter((a) => VERIFIED_KYC.includes(a.kycStatus));
  if (tab === 'pending') return list.filter((a) => !VERIFIED_KYC.includes(a.kycStatus));
  return list;
}
/** The ids of KYC-verified pending assignments — the "Approve Verified (N)" bulk set. Each is approved by the same
 * per-item authorized action (the app performs no god-mode bulk mutation, Law 11). */
export function verifiedApprovalIds(assignments: readonly RoleAssignment[] | null | undefined): string[] {
  return (assignments ?? []).filter((a) => VERIFIED_KYC.includes(a.kycStatus)).map((a) => a.id);
}

/** Human file size for a generated report (154). Base-1024; KB with no decimals, MB with one; guards junk.
 * Bytes are a size, NOT money — never routed through MoneyText (Law 2 is about currency). Returns '—' for
 * missing/invalid so the row degrades honestly rather than printing "NaN". */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Icon glyph for a report kind (154) — UI chrome derived from the report's category, NOT fabricated data.
 * Unknown kinds fall back to the generic document glyph. */
export function reportKindIcon(kind: string | null | undefined): string {
  switch ((kind ?? '').toLowerCase()) {
    case 'gmv': case 'revenue': return '📊';
    case 'activity': case 'traffic': case 'farmer_activity': return '📈';
    case 'compliance': case 'gst': case 'nabard': return '💰';
    default: return '📄';
  }
}

/** Campaign (broadcast-history) tabs (158): the design's Live / Scheduled / Done buckets over the REAL broadcast
 * status enum (queued → sending → sent | failed). Live = actively fanning out; Scheduled = queued, not yet sent;
 * Done = terminal (sent or failed). Pure. */
export type CampaignTab = 'live' | 'scheduled' | 'done';
export function campaignTab(status: string): CampaignTab {
  switch (status) {
    case 'sending': return 'live';
    case 'queued': return 'scheduled';
    default: return 'done'; // sent | failed
  }
}
export function campaignTabCounts(list: readonly { status: string }[] | null | undefined): Record<CampaignTab, number> {
  const c: Record<CampaignTab, number> = { live: 0, scheduled: 0, done: 0 };
  for (const b of list ?? []) c[campaignTab(b.status)] += 1;
  return c;
}
export function filterCampaignsByTab<T extends { status: string }>(list: readonly T[] | null | undefined, tab: CampaignTab): T[] {
  return (list ?? []).filter((b) => campaignTab(b.status) === tab);
}

/** Broadcast composer limits (157). Title ≤160 (server cap); body ≤280 (design cap; the server allows more but
 * we hold the tighter UX limit for SMS-friendliness). The server re-validates (zod .strict). */
export const BROADCAST_TITLE_MAX = 160;
export const BROADCAST_BODY_MAX = 280;
export interface BroadcastResult { ok: boolean; input?: { title: string; body: string }; reason?: 'title' | 'body' }
/** Validate the broadcast form (pure): title + body required and within limits. */
export function validateBroadcast(form: { title?: string; body?: string }): BroadcastResult {
  const title = (form.title ?? '').trim();
  if (title.length === 0 || title.length > BROADCAST_TITLE_MAX) return { ok: false, reason: 'title' };
  const body = (form.body ?? '').trim();
  if (body.length === 0 || body.length > BROADCAST_BODY_MAX) return { ok: false, reason: 'body' };
  return { ok: true, input: { title, body } };
}

const E164 = /^\+?[1-9]\d{7,14}$/;
/** Validate the add-farmer form (phone required, E.164-ish; the server re-validates + normalizes). */
export function validateAddFarmer(form: { phone?: string; fullName?: string }): { ok: true; input: { phone: string; fullName?: string } } | { ok: false; reason: 'phone' } {
  const phone = (form.phone ?? '').trim().replace(/[\s-]/g, '');
  if (!E164.test(phone)) return { ok: false, reason: 'phone' };
  const fullName = (form.fullName ?? '').trim();
  return { ok: true, input: { phone, ...(fullName ? { fullName } : {}) } };
}
