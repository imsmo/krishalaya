'use server';
// apps/web-tenant/src/app/billing/actions.ts · apply for / change the tenant's subscription plan. The only place
// the authed tenantClient() writes for the billing path. tenancy.apply is idempotent (Idempotency-Key, Law 3) —
// a paid plan moves money SERVER-SIDE (the app never does, Law 11). Validation lives in features/billing/plan.ts;
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildApply } from '../../features/billing/plan';
import { SdkError } from '@krishalaya/sdk-js';

export async function applyPlanAction(formData: FormData): Promise<void> {
  await requireSession('/billing');
  const built = buildApply({ planId: String(formData.get('planId') ?? ''), billingCycle: String(formData.get('billingCycle') ?? '') });
  if (!built.ok) redirect(`/billing?error=${built.error}`);
  try {
    await tenantClient().tenancy.apply(built.value, randomUUID());
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'apply') : 'apply';
    redirect(`/billing?error=${encodeURIComponent(code === 'apply' ? 'apply' : code)}`);
  }
  revalidatePath('/billing');
  redirect('/billing?ok=applied');
}

export async function changePlanAction(formData: FormData): Promise<void> {
  await requireSession('/billing');
  const subscriptionId = String(formData.get('subscriptionId') ?? '').trim();
  const planId = String(formData.get('planId') ?? '').trim();
  if (!subscriptionId || !planId) redirect('/billing?error=apply');
  try {
    await tenantClient().tenancy.changePlan(subscriptionId, planId);
  } catch (e) {
    redirect(`/billing?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'apply') : 'apply')}`);
  }
  revalidatePath('/billing');
  redirect('/billing?ok=changed');
}

export async function cancelSubscriptionAction(formData: FormData): Promise<void> {
  await requireSession('/billing');
  const subscriptionId = String(formData.get('subscriptionId') ?? '').trim();
  const atPeriodEnd = String(formData.get('atPeriodEnd') ?? 'true') !== 'false';
  if (!subscriptionId) redirect('/billing?error=apply');
  try {
    await tenantClient().tenancy.cancelSubscription(subscriptionId, atPeriodEnd);
  } catch (e) {
    redirect(`/billing?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'cancel') : 'cancel')}`);
  }
  revalidatePath('/billing');
  redirect(`/billing?ok=${atPeriodEnd ? 'cancelScheduled' : 'cancelled'}`);
}
