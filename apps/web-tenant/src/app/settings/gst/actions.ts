'use server';
// apps/web-tenant/src/app/settings/gst/actions.ts · W2424-W2427's two mutations (PC-56 TENANT-4d-3).
// 'use server' modules export ONLY async functions. Validation lives in features/settings/tax-identity.ts and
// the API re-enforces every rule — these actions carry data between the four states of one act.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { idempotencyKeyFor } from '../../../features/settings/tax-identity';
import { SdkError } from '@krishalaya/sdk-js';

const FIELDS = ['gstin', 'pan', 'cinOrRegNo', 'fssaiLicense', 'legalName', 'ownerName', 'ownerPhone', 'ownerEmail'] as const;

/** Only the fields the tenant actually TOUCHED travel on. Sending every field on every submit would turn a
 *  one-field edit into an eight-field diff, and W2425's review would show changes nobody made. */
function submittedFrom(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = formData.get(f);
    if (v !== null) out[f] = String(v);
  }
  return out;
}

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** Form → review (W2424 → W2425). Nothing is saved; the page re-asks the API for errors and the diff. */
export async function previewTaxIdentityAction(formData: FormData): Promise<void> {
  await requireSession('/settings/gst');
  const submitted = submittedFrom(formData);
  // Straight to review: the page's own preview call decides whether the tenant sees the diff or lands back on
  // the form with W2424's per-field errors. One round trip, one source of truth for validity — the API's.
  redirect(`/settings/gst?${qs({ ...submitted, step: 'review' })}`);
}

/** Review → applied (W2425 → W2426/W2427). The only write. */
export async function submitTaxIdentityAction(formData: FormData): Promise<void> {
  await requireSession('/settings/gst');
  const submitted = submittedFrom(formData);
  const reason = String(formData.get('reason') ?? '').trim();

  // The patch: an empty string means CLEAR (null), which is a real act a tenant may perform — deregistering,
  // or removing a value that should never have been there.
  const patch: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(submitted)) patch[k] = v === '' ? null : v;

  // THE KEY IS DERIVED FROM THE CHANGE (see idempotencyKeyFor): W2427's Retry must not apply the edit twice,
  // and a fresh uuid per click would let it. The server-computed diff is the honest input, so we ask for it
  // rather than deriving the key from the raw form.
  let key: string;
  try {
    const pv = await tenantClient().tenancy.profile.preview({ ...patch, ...(reason ? { reason } : {}) } as never);
    key = idempotencyKeyFor(pv.diff, reason || null);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || '') : '';
    redirect(`/settings/gst?${qs({ ...submitted, reason, step: 'failed', code })}`);
  }

  try {
    await tenantClient().tenancy.profile.update({ ...patch, ...(reason ? { reason } : {}) } as never, key);
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || '') : '';
    // W2427: nothing was changed (the write is one transaction), the reason is named, and the retry path is
    // chosen by the code — back to the form for a validation refusal, back to confirm for an infrastructure one.
    redirect(`/settings/gst?${qs({ ...submitted, reason, step: 'failed', code })}`);
  }

  revalidatePath('/settings/gst');
  revalidatePath('/billing');   // the GSTIN W120 prints comes from here
  redirect('/settings/gst?step=done');
}
