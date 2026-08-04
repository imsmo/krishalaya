'use server';
// apps/web-tenant/src/app/ambassadors/actions.ts · ambassadors admin mutations. Every write goes through the SDK to
// the audited, RBAC-gated (`ambassador.manage`) + `ambassadors`-flagged API, which runs the profile/referral state
// machines and computes + moves ALL commission SERVER-SIDE through the wallet ledger (Law 2/11) — this layer only
// shapes + pre-validates the form and surfaces the API's typed error code. Payout carries a fresh Idempotency-Key
// (Law 3). 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { validateEnroll, validateTarget } from '../../features/ambassadors/admin';

const PATH = '/ambassadors';
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };
const back = (id?: string) => id ? `${PATH}?ambassador=${encodeURIComponent(id)}` : PATH;

function fail(e: unknown, id?: string): never {
  redirect(`${back(id)}${back(id).includes('?') ? '&' : '?'}error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
}

export async function enrollAmbassadorAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const userId = String(formData.get('userId') ?? '').trim();
  const monthlyStipendMinor = opt(formData.get('monthlyStipendMinor'));
  const bad = validateEnroll({ userId, monthlyStipendMinor });
  if (bad) redirect(`${PATH}?error=${bad}`);
  try {
    await tenantClient().ambassadors.enroll({ userId, monthlyStipendMinor: monthlyStipendMinor ?? '0', kioskEnabled: String(formData.get('kioskEnabled') ?? '') === 'on', aepsEnabled: String(formData.get('aepsEnabled') ?? '') === 'on' });
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=enrolled`);
}

export async function setAmbassadorActiveAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const active = String(formData.get('active') ?? '') === 'true';
  if (!id) redirect(`${PATH}?error=save`);
  try { active ? await tenantClient().ambassadors.reinstate(id) : await tenantClient().ambassadors.suspend(id); } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=${active ? 'reinstated' : 'suspended'}`);
}

export async function updateAmbassadorAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  const patch: { monthlyStipendMinor?: string; kioskEnabled?: boolean; aepsEnabled?: boolean; trainingCompleted?: boolean } = {};
  const stipend = opt(formData.get('monthlyStipendMinor'));
  if (stipend != null) { if (!/^\d{1,15}$/.test(stipend)) redirect(`${back(id)}&error=stipend`); patch.monthlyStipendMinor = stipend; }
  patch.kioskEnabled = String(formData.get('kioskEnabled') ?? '') === 'on';
  patch.aepsEnabled = String(formData.get('aepsEnabled') ?? '') === 'on';
  if (String(formData.get('trainingCompleted') ?? '') === 'on') patch.trainingCompleted = true;
  try { await tenantClient().ambassadors.update(id, patch); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=updated`);
}

export async function payoutAmbassadorAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().ambassadors.payout(id, randomUUID()); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=paid`);
}

export async function activateReferralAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const referralId = String(formData.get('referralId') ?? '').trim();
  const ambassadorId = opt(formData.get('ambassadorId'));
  if (!referralId) redirect(`${back(ambassadorId)}&error=referral`);
  try { await tenantClient().ambassadors.activateReferral(referralId); } catch (e) { fail(e, ambassadorId); }
  revalidatePath(PATH);
  redirect(`${back(ambassadorId)}&ok=activated`);
}

export async function setTargetAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const ambassadorId = String(formData.get('ambassadorId') ?? '').trim();
  const metric = String(formData.get('metric') ?? '').trim();
  const periodStart = String(formData.get('periodStart') ?? '').trim();
  const periodEnd = String(formData.get('periodEnd') ?? '').trim();
  const targetValue = String(formData.get('targetValue') ?? '').trim();
  const bad = validateTarget({ ambassadorId, metric, periodStart, periodEnd, targetValue });
  if (bad) redirect(`${back(ambassadorId)}&error=${bad}`);
  try {
    await tenantClient().ambassadors.setTarget({ ambassadorId, metric: metric as 'onboardings' | 'sales_facilitated' | 'earnings_minor' | 'visits', periodStart, periodEnd, targetValue });
  } catch (e) { fail(e, ambassadorId); }
  revalidatePath(PATH);
  redirect(`${back(ambassadorId)}&ok=target`);
}
