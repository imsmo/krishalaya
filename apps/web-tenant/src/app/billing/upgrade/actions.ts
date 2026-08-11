'use server';
// apps/web-tenant/src/app/billing/upgrade/actions.ts · W119's two actions and their chains (PC-56 TENANT-1d-2).
//
// **NEITHER ACTION SENDS AN AMOUNT.** They send a plan id. Every figure — the prorated charge, the credit, the tax, the
// total — is recomputed by the API, because a form that could post the total due could post a smaller one.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';

const BASE = '/billing/upgrade';
const back = (q: string): never => redirect(`${BASE}?${q}`);

function errKey(e: unknown): string {
  if (e instanceof SdkError) {
    // The tax rate could not be read, so no invoice was raised. Its own message, because "try again later" is the correct
    // advice here and "check your details" is not.
    if (e.code === 'BILLING_TAX_RATE_UNAVAILABLE') return 'taxUnavailable';
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'conflict';
    if (e.status === 400 || e.status === 422) return 'invalid';
    if (e.status === 503) return 'unavailable';
  }
  return 'generic';
}

/**
 * Apply the change.
 *
 * The confirm step is the PREVIEW page itself (`?planId=…`), which is W2811's explicit confirm: the tenant sees the plan, the
 * arithmetic and the effective date before this action exists on screen. W119's own button sits under the invoice panel.
 */
export async function changePlanAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const subscriptionId = String(formData.get('subscriptionId') ?? '').trim();
  const planId = String(formData.get('planId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!subscriptionId || !planId) back('error=invalid');

  let replayed = false; let direction = 'upgrade';
  try {
    const res = await tenantClient().tenancy.changePlan(subscriptionId, planId, reason || undefined);
    replayed = res.replayed;
    direction = res.change.direction;
  } catch (e) { back(`error=${errKey(e)}`); }

  revalidatePath(BASE);
  revalidatePath('/billing');
  // **A REPLAY IS ITS OWN MESSAGE.** "Already done — this is the same invoice" is the sentence that stops a tenant who
  // double-clicked from believing they have been charged twice, which is what a second success page would imply.
  if (replayed) back('ok=replayed');
  back(direction === 'upgrade' ? 'ok=upgraded' : 'ok=scheduled');
}

/** Cancel a scheduled downgrade before its effective date. */
export async function cancelPendingChangeAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const subscriptionId = String(formData.get('subscriptionId') ?? '').trim();
  if (!subscriptionId) back('error=invalid');
  try { await tenantClient().tenancy.cancelPendingPlanChange(subscriptionId); }
  catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath(BASE);
  revalidatePath('/billing');
  back('ok=cancelled');
}
