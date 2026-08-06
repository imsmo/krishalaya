'use server';
// apps/web-admin/src/app/billing/actions.ts · god-mode SaaS-billing mutations. The ONLY place the admin bearer
// writes for the billing path. Each is re-authorised SERVER-SIDE by admin-api (owner perm + FIDO2 hardware-key +
// step-up — consequential billing/money controls, Law 11) and carries the operator's mandatory audit reason. The
// adjustment is a MONEY MOVE (service → wallet-service): it carries a client-supplied idempotencyKey in the body
// (a fresh randomUUID here) so a double-submit/refresh never double-posts; amount stays a minor-unit STRING (Law 2,
// never floated). 'use server' modules export ONLY async functions — validation lives in features/billing/billing.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, AdminApiError } from '../../lib/admin-client';
import { buildAdjustment, buildDunning, validReason } from '../../features/billing/billing';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'illegal';
    if (e.status === 404) return 'notFound';
    if (e.status === 422) return 'amount';
  }
  return 'generic';
}

export async function updateInvoiceAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const action = String(formData.get('action') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (!id) redirect('/billing/invoices');
  if (!['issue', 'mark_overdue', 'void'].includes(action)) redirect(`/billing/invoices/${encodeURIComponent(id)}?error=generic`);
  if (!validReason(reason)) redirect(`/billing/invoices/${encodeURIComponent(id)}?error=reason`);
  try { await adminPatch(`billing/invoices/${encodeURIComponent(id)}`, { body: { action, reason: reason.trim() } }); }
  catch (e) { redirect(`/billing/invoices/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/billing/invoices/${id}`);
  redirect(`/billing/invoices/${encodeURIComponent(id)}?ok=${action}`);
}

export async function recordDunningAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/billing/invoices');
  const built = buildDunning({
    channel: String(formData.get('channel') ?? ''),
    outcome: String(formData.get('outcome') ?? ''),
    note: String(formData.get('note') ?? ''),
  });
  if (!built.ok) redirect(`/billing/invoices/${encodeURIComponent(id)}?error=${built.error}`);
  try { await adminPost(`billing/invoices/${encodeURIComponent(id)}/dunning`, { body: built.value }); }
  catch (e) { redirect(`/billing/invoices/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/billing/invoices/${id}`);
  redirect(`/billing/invoices/${encodeURIComponent(id)}?ok=dunning`);
}

/** PC-56 ADMIN-1 · record a dunning touch FROM THE COLLECTION QUEUE. Same server call as the invoice page (one
 *  write path, one set of guards); what differs is where the operator is standing. Returning them to the queue with
 *  their tier filter intact is not cosmetic — a collections officer works a list top-to-bottom, and a redirect that
 *  dropped the filter would silently restart them on a different set of debtors. */
export async function recordDunningFromQueueAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const tier = String(formData.get('tier') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/billing/dunning?${tier ? `tier=${encodeURIComponent(tier)}&` : ''}${qs}`);
  if (!id) back('error=notFound');
  const built = buildDunning({
    channel: String(formData.get('channel') ?? ''),
    outcome: String(formData.get('outcome') ?? ''),
    note: String(formData.get('note') ?? ''),
  });
  if (!built.ok) back(`error=${built.error}`);
  try { await adminPost(`billing/invoices/${encodeURIComponent(id)}/dunning`, { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath('/billing/dunning');
  revalidatePath(`/billing/invoices/${id}`);
  back('ok=dunning');
}

export async function applyAdjustmentAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildAdjustment({
    tenantId: String(formData.get('tenantId') ?? ''),
    direction: String(formData.get('direction') ?? ''),
    amountMinor: String(formData.get('amountMinor') ?? ''),
    currency: String(formData.get('currency') ?? ''),
    reason: String(formData.get('reason') ?? ''),
    subscriptionId: String(formData.get('subscriptionId') ?? ''),
    invoiceId: String(formData.get('invoiceId') ?? ''),
  });
  if (!built.ok) redirect(`/billing/adjustments?error=${built.error}`);
  try { await adminPost('billing/adjustments', { body: { ...built.value, idempotencyKey: randomUUID() } }); }
  catch (e) { redirect(`/billing/adjustments?error=${errorKey(e)}`); }
  revalidatePath('/billing/adjustments');
  redirect('/billing/adjustments?ok=adjusted');
}
