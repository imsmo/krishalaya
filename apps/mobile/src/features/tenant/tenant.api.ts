// apps/mobile/src/features/tenant/tenant.api.ts · data layer for tenant-admin-lite (P-17). Keeps screens thin
// (guide §3). Reads degrade-never-die (null/empty). Mutations (approve / resolve / add-farmer / apply / KYC
// review) are ONLINE transitions that throw so the screen shows the precise outcome (403 not-allowed, 409 illegal)
// — the SERVER authorizes every action against the tenant admin's OWN permissions (NOT god-mode, Law 11).
// add-farmer + apply carry an Idempotency-Key (Law 3). Money is bigint minor strings (Law 2).
import type { Plan, Subscription, RoleAssignment, Dispute, DisputeMessage, UserProfile, ListingCard, PayoutSummary, TenantAnalytics, TenantBroadcast } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

/** The calling tenant's own analytics over a window (dashboard KPIs — screen 08). Degrades to null on failure. */
export async function tenantAnalytics(from?: string, to?: string): Promise<TenantAnalytics | null> {
  try { return await apiClient().tenancy.analytics({ from, to }); } catch { return null; }
}

export interface DisputesPage { items: Dispute[]; nextCursor: string | null }
export interface ListingsPage { items: ListingCard[]; nextCursor: string | null }
export interface PayoutsPage { items: PayoutSummary[]; nextCursor: string | null }

// --- subscription / plans (06 apply / 07 pending) ---
export async function plans(): Promise<Plan[]> {
  try { return await apiClient().tenancy.plans(); } catch { return []; }
}
export async function currentSubscription(): Promise<Subscription | null> {
  try { return (await apiClient().tenancy.currentSubscription()).subscription; } catch { return null; }
}
/** The full billing dashboard (85): plan catalogue + the tenant's subscription + its plan limits + current usage.
 * Degrades to empty on failure. Money is bigint minor; usage/limits are integer-count strings. */
export interface BillingDashboard { plans: Plan[]; subscription: Subscription | null; limits: Record<string, string>; usage: Record<string, string> }
export async function billingDashboard(): Promise<BillingDashboard> {
  try {
    const [catalogue, current] = await Promise.all([
      apiClient().tenancy.plans().catch(() => [] as Plan[]),
      apiClient().tenancy.currentSubscription().catch(() => ({ subscription: null, limits: {}, usage: {} })),
    ]);
    return { plans: catalogue, subscription: current.subscription, limits: current.limits ?? {}, usage: current.usage ?? {} };
  } catch { return { plans: [], subscription: null, limits: {}, usage: {} }; }
}
export function applyForPlan(planId: string, billingCycle?: 'monthly' | 'annual'): Promise<Subscription> {
  return apiClient().tenancy.apply({ planId, billingCycle }, newId());
}

// --- roster + approvals (76 farmers / 147 approvals) ---
export async function assignments(opts: { roleCode?: string; pendingOnly?: boolean } = {}): Promise<RoleAssignment[]> {
  try { return await apiClient().rbac.assignments(opts); } catch { return []; }
}
export function approveAssignment(id: string): Promise<{ ok: boolean }> {
  return apiClient().rbac.approveAssignment(id);
}
/** Reject / remove a PENDING assignment (the ✕ on the queue) = revoke the assignment. Needs identity.approve;
 * authorized + tenant-scoped SERVER-SIDE (NOT god-mode, Law 11). Throws so the screen shows the exact outcome. */
export function rejectAssignment(id: string): Promise<{ ok: boolean }> {
  return apiClient().rbac.revoke(id);
}

// --- users (77 farmer-detail / 78 add-farmer) ---
export async function getUser(id: string): Promise<UserProfile | null> {
  try { return await apiClient().users.get(id); } catch { return null; }
}
export function addFarmer(input: { phone: string; fullName?: string }): Promise<UserProfile> {
  return apiClient().users.create(input, newId());
}

// --- KYC review (148 approve-detail) ---
export function reviewKyc(id: string, decision: 'verify' | 'reject', reason?: string): Promise<{ id: string; status: string }> {
  return apiClient().kyc.review(id, { decision, reason });
}

// --- disputes (155/156) ---
export async function disputesList(status?: string, cursor?: string): Promise<DisputesPage> {
  try { return await apiClient().disputes.list({ box: 'all', status, cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getDispute(id: string): Promise<Dispute | null> {
  try { return await apiClient().disputes.get(id); } catch { return null; }
}
/** The dispute's append-only evidence/conversation thread (156). Read-only; degrades to empty. */
export async function disputeMessages(id: string): Promise<DisputeMessage[]> {
  try { return (await apiClient().disputes.messages(id)).items; } catch { return []; }
}
export function reviewDispute(id: string): Promise<Dispute> { return apiClient().disputes.review(id); }
export function escalateDispute(id: string): Promise<Dispute> { return apiClient().disputes.escalate(id); }
export function resolveDispute(id: string, body: { resolutionType: string; resolutionAmountMinor?: string; note?: string }): Promise<Dispute> {
  return apiClient().disputes.resolve(id, body);
}

// --- broadcast (157). Compose + send a message to the tenant's farmers. audienceRoleCode omitted = all active
// members; the comm module resolves each recipient's channels (app/SMS/voice) + quiet hours SERVER-SIDE. Carries
// an Idempotency-Key (Law 3); authorized SERVER-SIDE (comm.manage, NOT god-mode Law 11). Throws so the screen
// shows the exact outcome (incl. the REAL recipientCount from TenantBroadcast).
export function sendBroadcast(input: { title: string; body: string; audienceRoleCode?: string }): Promise<TenantBroadcast> {
  return apiClient().tenancy.broadcast(input, newId());
}
/** Campaign history (158): the tenant's past + in-flight broadcasts. Read-only; degrades to empty. */
export async function listCampaigns(): Promise<TenantBroadcast[]> {
  try { return (await apiClient().tenancy.listBroadcasts()).items; } catch { return []; }
}

// --- reports archive (154 export-reports). A tenant's SAVED SCHEDULES + RECENTLY GENERATED files. There is no
// typed SDK resource yet, so we call the ASSUMED contract `GET tenancy/reports` via the request() escape-hatch
// (guide §2.6) and degrade-never-die to empty (Law 12) — the screen then shows a designed "manage on web console"
// notice instead of fabricating anita@…/2.4 MB/dates (§13). When the backend read-model ships, the screen
// populates live with zero UI edits. Report titles/cadence/recipient/size/date are DATA from the server; the
// "SCHEDULED" pill + section labels are static i18n chrome. No money on this screen (file bytes ≠ currency).
export interface ScheduledReport { id: string; kind?: string; title: string; cadence?: string; recipient?: string }
export interface GeneratedReport { id: string; kind?: string; title: string; sizeBytes?: number; format?: string; generatedAt?: string; autoFiled?: boolean; downloadPath?: string }
export interface ReportsArchive { scheduled: ScheduledReport[]; generated: GeneratedReport[] }
export async function reportsArchive(): Promise<ReportsArchive> {
  try {
    const r = await apiClient().request<Partial<ReportsArchive>>('GET', 'tenancy/reports');
    return { scheduled: r.data?.scheduled ?? [], generated: r.data?.generated ?? [] };
  } catch { return { scheduled: [], generated: [] }; }
}

// --- monitoring (79 listings / 80 payouts). Read-only; tenant-scoped server-side. Degrade to empty. ---
export async function tenantListings(cursor?: string): Promise<ListingsPage> {
  try { return await apiClient().listings.browse({ cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function tenantPayouts(cursor?: string): Promise<PayoutsPage> {
  try { return await apiClient().payouts.list(cursor); } catch { return { items: [], nextCursor: null }; }
}
