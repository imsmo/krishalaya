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
import { buildPayIntent } from '../../features/billing/invoices';
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

// **`changePlanAction` REMOVED (PC-56 TENANT-1d-2).** It posted a plan id straight from the /billing plan cards with no
// preview. That was harmless while a plan change billed nothing; now that an upgrade raises a prorated invoice due in 7
// days, a one-click change with no invoice shown first would charge a tenant money they had never been quoted — and W119's
// own promise is "proration always previews before any payment". The card links to /billing/upgrade instead.

/**
 * W2428-W2430: pay an open SaaS invoice.
 *
 * **THE AMOUNT IS NOT IN THE FORM AND IS NOT COMPUTED HERE.** The form posts an invoice id; this action asks
 * the API for the quote (total_minor − paid_minor, resolved server-side), passes that figure to the payment
 * intent, and the API re-checks it against the invoice before any gateway order is created. `POST /v1/payments`
 * accepts an arbitrary `amountMinor`, so a client that could name its own figure could open a ₹1 gateway order
 * against a ₹7,954 bill, capture it, and leave the invoice `partially_paid` while the tenant believed it had
 * paid. Two reads of one number, both from the server, and a server-side refusal on mismatch.
 *
 * ONE IDEMPOTENCY KEY PER (invoice, outstanding amount): W2430's Retry must reuse the same gateway order rather
 * than opening a second one, and it must NOT reuse it once the amount has changed (a bank transfer landed in
 * between) — the key carries the amount so both are true without any state of our own.
 */
export async function payInvoiceAction(formData: FormData): Promise<void> {
  await requireSession('/billing');
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  let quote;
  try { quote = await tenantClient().tenancy.billing.payQuote(invoiceId); }
  catch (e) { redirect(`/billing?payError=${encodeURIComponent(e instanceof SdkError ? (e.code || 'quote') : 'quote')}`); }
  const built = buildPayIntent(quote, invoiceId);
  if (!built.ok) redirect(`/billing?payError=${encodeURIComponent(built.error)}`);
  let intent;
  try {
    intent = await tenantClient().payments.createIntent(built.value, `saas-inv:${invoiceId}:${built.value.amountMinor}`);
  } catch (e) {
    redirect(`/billing?payError=${encodeURIComponent(e instanceof SdkError ? (e.code || 'pay') : 'pay')}`);
  }
  revalidatePath('/billing');
  // The gateway checkout is opened by the payment surface, which owns the provider handoff — this action never
  // talks to a PSP itself. The invoice moves to `paid` only when the capture webhook is relayed and the receipt
  // is recorded, never optimistically from here.
  redirect(`/billing/invoices/${encodeURIComponent(invoiceId)}?payment=${encodeURIComponent(intent.paymentId)}`);
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
