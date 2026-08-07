'use server';
// apps/web-admin/src/app/recon/actions.ts · god-mode money-safety mutations. The ONLY place the admin bearer writes
// for the recon path. Each is re-authorised SERVER-SIDE by admin-api (owner perm + FIDO2 hardware-key + step-up —
// consequential money controls, Law 11) and carries the operator's mandatory audit reason/summary/note. admin-api
// exposes no Idempotency-Key here, so none is passed; mutations never auto-retry. recon NEVER posts the ledger —
// a freeze only flips wallet_accounts.is_frozen server-side. 'use server' modules export ONLY async functions —
// validation lives in features/recon/recon.ts.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, AdminApiError } from '../../lib/admin-client';
import { validReason, SEVERITIES, type Severity } from '../../features/recon/recon';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'illegal';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

export async function openInvestigationAction(formData: FormData): Promise<void> {
  requireAdmin();
  const runId = String(formData.get('runId') ?? '').trim();
  const summary = String(formData.get('summary') ?? '');
  const sevRaw = String(formData.get('severity') ?? 'high');
  const severity: Severity = (SEVERITIES as readonly string[]).includes(sevRaw) ? (sevRaw as Severity) : 'high';
  if (!runId) redirect('/recon/runs');
  if (!validReason(summary)) redirect(`/recon/runs/${encodeURIComponent(runId)}?error=summary`);
  let id: string | undefined;
  try {
    const res = await adminPost<{ id: string }>('recon/investigations', { body: { runId, severity, summary: summary.trim() } });
    id = res.data?.id;
  } catch (e) { redirect(`/recon/runs/${encodeURIComponent(runId)}?error=${errorKey(e)}`); }
  if (id) redirect(`/recon/investigations/${encodeURIComponent(id)}?ok=opened`);
  redirect('/recon/investigations?ok=opened');
}

export async function updateInvestigationAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const action = String(formData.get('action') ?? '');
  const note = String(formData.get('note') ?? '');
  if (!id) redirect('/recon/investigations');
  if (!['start', 'resolve', 'false_positive'].includes(action)) redirect(`/recon/investigations/${encodeURIComponent(id)}?error=generic`);
  if (!validReason(note)) redirect(`/recon/investigations/${encodeURIComponent(id)}?error=note`);
  try { await adminPatch(`recon/investigations/${encodeURIComponent(id)}`, { body: { action, note: note.trim() } }); }
  catch (e) { redirect(`/recon/investigations/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/recon/investigations/${id}`);
  redirect(`/recon/investigations/${encodeURIComponent(id)}?ok=${action}`);
}

export async function freezeAccountAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const action = String(formData.get('action') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (!id) redirect('/recon');
  if (action !== 'freeze' && action !== 'unfreeze') redirect(`/recon/accounts/${encodeURIComponent(id)}?error=generic`);
  if (!validReason(reason)) redirect(`/recon/accounts/${encodeURIComponent(id)}?error=reason`);
  try { await adminPost(`recon/accounts/${encodeURIComponent(id)}/freeze`, { body: { action, reason: reason.trim() } }); }
  catch (e) { redirect(`/recon/accounts/${encodeURIComponent(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/recon/accounts/${id}`);
  redirect(`/recon/accounts/${encodeURIComponent(id)}?ok=${action}`);
}

/* ==================== PC-56 ADMIN-6 · ledger truth ==================== */

/** W064's "Verify chain (period)" / W065's "Verify hashes" — the first code on this platform that reads `prev_hash`.
 *
 *  The RESULT IS PASSED BACK IN THE URL rather than refetched, because a chain verification is a point-in-time
 *  measurement: refetching would run the walk again and could return a different answer, which on a P0 finding is the
 *  last thing anybody wants. The verification is also recorded server-side, so the URL is a convenience and never the
 *  record. */
export async function verifyChainAction(formData: FormData): Promise<void> {
  requireAdmin();
  const txnId = String(formData.get('txnId') ?? '').trim();
  const accountId = String(formData.get('accountId') ?? '').trim();
  if (!txnId || !accountId) redirect('/recon/ledger');
  let payload = '';
  try {
    const r = await adminPost<Record<string, unknown>>('ledger/chain/verify', { body: { accountId } });
    payload = Buffer.from(JSON.stringify(r.data)).toString('base64');
  } catch (e) { redirect(`/recon/ledger/${encodeURIComponent(txnId)}?error=${ledgerErrorKey(e)}`); }
  revalidatePath(`/recon/ledger/${txnId}`);
  redirect(`/recon/ledger/${encodeURIComponent(txnId)}?verified=${encodeURIComponent(payload)}`);
}

/** W059's "Verify balances vs ledger", for one account. The DELTA travels back in the URL because the number is the
 *  whole message: "they disagree" without the size and direction does not tell an operator whether a farmer has been
 *  shown money they do not have. */
export async function verifyBalanceAction(formData: FormData): Promise<void> {
  requireAdmin();
  const accountId = String(formData.get('accountId') ?? '').trim();
  if (!accountId) redirect('/recon/accounts');
  let matches = true; let delta = '0';
  try {
    const r = await adminPost<{ matches: boolean; deltaMinor: string }>(`ledger/accounts/${encodeURIComponent(accountId)}/verify-balance`, { body: {} });
    matches = r.data?.matches !== false;
    delta = r.data?.deltaMinor ?? '0';
  } catch (e) { redirect(`/recon/accounts?error=${ledgerErrorKey(e)}`); }
  revalidatePath('/recon/accounts');
  redirect(matches ? '/recon/accounts?ok=verified' : `/recon/accounts?ok=drift&delta=${encodeURIComponent(delta)}`);
}

function ledgerErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'conflict';
    if (e.status === 413) return 'windowTooWide';
    if (e.status === 400 || e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
