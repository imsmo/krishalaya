'use server';
// apps/web-admin/src/app/tenants/actions.ts · god-mode tenant lifecycle mutations. The ONLY place the admin bearer
// writes for the tenants path. Each is re-authorised SERVER-SIDE by admin-api (owner perm + FIDO2 hardware-key +
// step-up freshness — Law 11) and carries the operator's mandatory audit `reason` in the body (admin-api zod-
// validates it). admin-api exposes no Idempotency-Key on these endpoints, so none is passed; mutations never
// auto-retry. A 403 → re-auth prompt (?error=elevation), a 409 illegal transition → ?error=illegal, else generic.
// 'use server' modules export ONLY async functions — validation lives in features/tenants/tenant.ts.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, AdminApiError } from '../../lib/admin-client';
import { buildLimitOverride, validReason } from '../../features/tenants/tenant';
import { buildPlanChange, buildAddon } from '../../features/billing/subscription-write';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'illegal';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

async function lifecycle(action: 'approve' | 'suspend' | 'archive', formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const reason = String(formData.get('reason') ?? '');
  if (!id) redirect('/tenants');
  if (!validReason(reason)) redirect(`/tenants/${encodeURIComponent(id)}?error=reason`);
  try { await adminPost(`tenants/${encodeURIComponent(id)}/${action}`, { body: { reason: reason.trim() } }); }
  catch (e) { redirect(`/tenants/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/tenants/${id}`);
  redirect(`/tenants/${encodeURIComponent(id)}?ok=${action}`);
}

export async function approveTenantAction(formData: FormData): Promise<void> { return lifecycle('approve', formData); }
export async function suspendTenantAction(formData: FormData): Promise<void> { return lifecycle('suspend', formData); }
export async function archiveTenantAction(formData: FormData): Promise<void> { return lifecycle('archive', formData); }

export async function overrideLimitAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/tenants');
  const built = buildLimitOverride({
    limitCode: String(formData.get('limitCode') ?? ''),
    limitValue: String(formData.get('limitValue') ?? ''),
    reason: String(formData.get('reason') ?? ''),
    expiresAt: String(formData.get('expiresAt') ?? ''),
  });
  if (!built.ok) redirect(`/tenants/${encodeURIComponent(id)}?error=${built.error}`);
  try { await adminPatch(`tenants/${encodeURIComponent(id)}/limits`, { body: built.value }); }
  catch (e) { redirect(`/tenants/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/tenants/${id}`);
  redirect(`/tenants/${encodeURIComponent(id)}?ok=limits`);
}

// ---------------------------------------------------------------------------
// Subscription writes (PC-56 ADMIN-1c · closes ADMIN-1-Q10)
// ---------------------------------------------------------------------------
// These change what the NEXT invoice says. No money moves here, and none of them touches an invoice that has already
// been issued — re-pricing a document a tenant may have paid is not an edit, it is a dispute.

export async function changePlanAction(formData: FormData): Promise<void> {
  requireAdmin();
  const tenantId = String(formData.get('tenantId') ?? '').trim();
  if (!tenantId) redirect('/tenants');
  const back: (qs: string) => never = (qs) => redirect(`/tenants/${encodeURIComponent(tenantId)}/subscription?${qs}`);
  const built = buildPlanChange({
    planId: String(formData.get('planId') ?? ''),
    priceMajor: String(formData.get('priceMajor') ?? ''),
    billingCycle: String(formData.get('billingCycle') ?? ''),
    discountPct: String(formData.get('discountPct') ?? ''),
    immediate: String(formData.get('immediate') ?? '') === 'on',
    reason: String(formData.get('reason') ?? ''),
  }, String(formData.get('currentPlanId') ?? '') || null, majorToMinor);
  if (!built.ok) back(`error=sub_${built.error}`);
  try { await adminPost(`billing/subscriptions/${encodeURIComponent(tenantId)}/plan`, { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/tenants/${tenantId}/subscription`);
  back('ok=plan_changed');
}

export async function addAddonAction(formData: FormData): Promise<void> {
  requireAdmin();
  const tenantId = String(formData.get('tenantId') ?? '').trim();
  if (!tenantId) redirect('/tenants');
  const back: (qs: string) => never = (qs) => redirect(`/tenants/${encodeURIComponent(tenantId)}/subscription?${qs}`);
  const built = buildAddon({
    addonCode: String(formData.get('addonCode') ?? ''),
    quantity: String(formData.get('quantity') ?? ''),
    priceMajor: String(formData.get('priceMajor') ?? ''),
    startsOn: String(formData.get('startsOn') ?? ''),
    endsOn: String(formData.get('endsOn') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  }, majorToMinor);
  if (!built.ok) back(`error=addon_${built.error}`);
  try { await adminPost(`billing/subscriptions/${encodeURIComponent(tenantId)}/addons`, { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/tenants/${tenantId}/subscription`);
  back('ok=addon_added');
}

/** Schedule — or REVOKE — a cancellation at period end. One action, both directions: a tenant who changes their mind
 *  must not need a new subscription. */
export async function setCancelAtPeriodEndAction(formData: FormData): Promise<void> {
  requireAdmin();
  const tenantId = String(formData.get('tenantId') ?? '').trim();
  if (!tenantId) redirect('/tenants');
  const back: (qs: string) => never = (qs) => redirect(`/tenants/${encodeURIComponent(tenantId)}/subscription?${qs}`);
  const cancel = String(formData.get('cancel') ?? 'true') === 'true';
  const reason = String(formData.get('reason') ?? '');
  if (!validReason(reason)) back('error=sub_reason');
  try {
    await adminPost(`billing/subscriptions/${encodeURIComponent(tenantId)}/cancel-at-period-end`, {
      body: { cancel, reason: reason.trim() },
    });
  } catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/tenants/${tenantId}/subscription`);
  back(`ok=${cancel ? 'cancel_scheduled' : 'cancel_revoked'}`);
}

/** ₹ major → paise, integer-only (a regex, not parseFloat — Law 2). */
function majorToMinor(major: string): string | undefined {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(major.trim());
  if (!m) return undefined;
  return String(BigInt(m[1]) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0')));
}
