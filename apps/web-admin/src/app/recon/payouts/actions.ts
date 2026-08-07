'use server';
// apps/web-admin/src/app/recon/payouts/actions.ts · the money door's write path (PC-56 ADMIN-6b).
//
// THESE ARE THE ONLY MUTATIONS IN THIS CONSOLE THAT SEND MONEY TO A THIRD PARTY. Each is re-authorised SERVER-SIDE by
// admin-api: the owner permission `payouts.approve`, a FIDO2 hardware key, and step-up re-auth freshness. Nothing here
// is trusted — this file's job is to carry an intent and an id, and to route the operator to a page that tells them the
// truth about what happened.
//
// NO MONEY FIELD AND NO PREFLIGHT VERDICT IS SENT. The approve request has NO BODY at all. The batch is in the path, the
// approver is in the token, and the preflight is re-computed server-side — a client that could supply `pass: true` could
// authorise a disbursement over checks that failed, and that is the single most valuable field on the platform to forge.
//
// 'use server' modules export ONLY async functions; the pure validation lives in features/payouts/payouts.ts.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../lib/admin-client';

/** Map an API failure to a key the page can render.
 *
 *  409 IS ITS OWN CASE AND CARRIES THE SERVER'S SENTENCE, because on this plane a 409 is almost always one of three
 *  specific refusals the operator needs to read in full: you are the maker, the preflight blocked N payouts, or another
 *  checker decided this while you were looking at it. A generic "conflict" would send them to reload and try again,
 *  which for the third case would mean pressing Approve on somebody else's decision.
 */
function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'refused';
    if (e.status === 404) return 'notFound';
    if (e.status === 400) return 'invalid';
  }
  return 'generic';
}

export async function approveBatchAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/recon/payouts');
  try {
    // NO BODY. See the header.
    await adminPost(`payouts/batches/${encodeURIComponent(id)}/approve`, { body: {} });
  } catch (e) {
    redirect(`/recon/payouts/${encodeURIComponent(id)}?error=${errorKey(e)}`);
  }
  revalidatePath(`/recon/payouts/${id}`);
  // No Idempotency-Key is sent because admin-api exposes none on this route, so this mutation must never auto-retry —
  // a retried approval on a route without one could be a second authorisation. The conditional `WHERE status='open'` on
  // the server makes a genuine double-submit a refusal rather than a double-approve, which is the safe direction.
  redirect(`/recon/payouts/${encodeURIComponent(id)}?ok=approved`);
}

export async function returnBatchAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const reason = String(formData.get('reason') ?? '');
  if (!id) redirect('/recon/payouts');
  // Checked here so the operator sees a field error rather than a 400, and checked again by Zod and again by 0114's
  // CHECK. The floor is 20 characters because the maker is the only reader of this sentence.
  if (reason.trim().length < 20) redirect(`/recon/payouts/${encodeURIComponent(id)}?error=reason`);
  try {
    await adminPost(`payouts/batches/${encodeURIComponent(id)}/return`, { body: { reason: reason.trim() } });
  } catch (e) {
    redirect(`/recon/payouts/${encodeURIComponent(id)}?error=${errorKey(e)}`);
  }
  revalidatePath(`/recon/payouts/${id}`);
  redirect(`/recon/payouts/${encodeURIComponent(id)}?ok=returned`);
}

export async function preflightBatchAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/recon/payouts');
  try {
    await adminPost(`payouts/batches/${encodeURIComponent(id)}/preflight`, { body: {} });
  } catch (e) {
    redirect(`/recon/payouts/${encodeURIComponent(id)}?error=${errorKey(e)}`);
  }
  revalidatePath(`/recon/payouts/${id}`);
  redirect(`/recon/payouts/${encodeURIComponent(id)}?ok=preflight`);
}

/** W062's "Run settlement cycle".
 *
 *  RECORDS A REQUEST; DOES NOT GENERATE STATEMENTS. The `?ok=` the operator lands on says exactly that, because the
 *  statements appear as the settlement worker generates them — and a success message reading "cycle complete" would be
 *  the fourth status-claiming-an-act-nobody-performed on this platform, in the wave that exists to remove the third.
 */
export async function requestCycleAction(formData: FormData): Promise<void> {
  requireAdmin();
  const periodStart = String(formData.get('periodStart') ?? '').trim();
  const periodEnd = String(formData.get('periodEnd') ?? '').trim();
  const back = periodEnd ? `/recon/settlements?cycle=${encodeURIComponent(periodEnd)}` : '/recon/settlements';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    redirect(`${back}&error=date`.replace('settlements&', 'settlements?'));
  }
  try {
    await adminPost('payouts/settlement/cycles', { body: { periodStart, periodEnd } });
  } catch (e) {
    redirect(`/recon/settlements?cycle=${encodeURIComponent(periodEnd)}&error=${errorKey(e)}`);
  }
  revalidatePath('/recon/settlements');
  redirect(`/recon/settlements?cycle=${encodeURIComponent(periodEnd)}&ok=cycleRequested`);
}
