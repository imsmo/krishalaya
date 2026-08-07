'use server';
// apps/web-admin/src/app/recon/corrections/actions.ts · W068 mutations (PC-56 ADMIN-5e).
//
// The only place the admin bearer posts a manual correction. Every route is re-authorised server-side
// (`ledger.investigate` to draft, `ledger.correct` to post) behind a hardware key and step-up, and the two-person
// rule refuses the maker even if one person somehow holds both.
//
// NO IDEMPOTENCY-KEY HEADER IS SENT, and that is not an omission. The key lives on the DRAFT (0111) and admin-api
// reuses it on every post attempt, so a retried approval returns the SAME ledger transaction rather than posting a
// second correction. A key minted here, per click, would defeat exactly the guarantee W068 promises.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../../lib/admin-client';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    // 409 covers the two-person rule, an unbalanced draft found at approval time, and the missing founder
    // confirmation — all STATE conflicts, all with a different next move than "ask for access".
    if (e.status === 409) return 'conflict';
    if (e.status === 502) return 'postFailed';
    if (e.status === 422 || e.status === 400) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
const enc = encodeURIComponent;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function submitCorrectionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  if (!id) redirect('/recon/corrections');
  try { await adminPost(`ledger/corrections/${enc(id)}/submit`, { body: {} }); }
  catch (e) { redirect(`/recon/corrections/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/recon/corrections/${id}`);
  revalidatePath('/recon/corrections');
  redirect(`/recon/corrections/${enc(id)}?ok=submitted`);
}

export async function approveCorrectionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  const note = s(formData, 'note');
  if (!id) redirect('/recon/corrections');
  if (!note) redirect(`/recon/corrections/${enc(id)}?error=invalid`);
  // An unchecked checkbox is ABSENT from the form data, so this is false unless the checker actually ticked it.
  const founderInformed = s(formData, 'founderInformed') === 'yes';
  try { await adminPost(`ledger/corrections/${enc(id)}/approve`, { body: { note, founderInformed } }); }
  catch (e) { redirect(`/recon/corrections/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/recon/corrections/${id}`);
  revalidatePath('/recon/corrections');
  revalidatePath('/recon/investigations');
  redirect(`/recon/corrections/${enc(id)}?ok=posted`);
}

export async function rejectCorrectionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  const note = s(formData, 'note');
  if (!id) redirect('/recon/corrections');
  if (!note) redirect(`/recon/corrections/${enc(id)}?error=invalid`);
  try { await adminPost(`ledger/corrections/${enc(id)}/reject`, { body: { note } }); }
  catch (e) { redirect(`/recon/corrections/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/recon/corrections/${id}`);
  revalidatePath('/recon/corrections');
  redirect(`/recon/corrections/${enc(id)}?ok=rejected`);
}

export async function withdrawCorrectionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = s(formData, 'id');
  const note = s(formData, 'note');
  if (!id) redirect('/recon/corrections');
  if (!note) redirect(`/recon/corrections/${enc(id)}?error=invalid`);
  try { await adminPost(`ledger/corrections/${enc(id)}/withdraw`, { body: { note } }); }
  catch (e) { redirect(`/recon/corrections/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/recon/corrections/${id}`);
  revalidatePath('/recon/corrections');
  redirect(`/recon/corrections/${enc(id)}?ok=withdrawn`);
}
