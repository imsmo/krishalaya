'use server';
// apps/web-tenant/src/app/kyc/actions.ts · the staff member's own profile + KYC mutations. The only place the
// authed tenantClient() writes for the KYC/profile path. Both re-authorised SERVER-SIDE (token-resolved subject,
// no id, no IDOR):
//   - updateProfileAction: PATCH /users/me with the PII-minimal validated patch (name/email/dob/gender/language/photo).
//     The SDK exposes no Idempotency-Key on PATCH /users/me, so none is passed (a re-applied patch is naturally idempotent).
//   - submitKycAction (PC-20, 2026-08-04): kyc.submit({docTypeId, mediaId, docNoMasked?}, Idempotency-Key). The
//     former SDK-gap flag is CLOSED — the SDK now exposes kyc.docTypes() (GET kyc/doc-types, seeded catalogue) and
//     the api controller exists. Raw doc numbers are refused client-side too (features/kyc/form masked rule).
// 'use server' modules export ONLY async functions — validation lives in features/*/form.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildProfilePatch } from '../../features/profile/form';
import { buildKycSubmission } from '../../features/kyc/form';
import { SdkError } from '@krishalaya/sdk-js';

export async function updateProfileAction(formData: FormData): Promise<void> {
  await requireSession('/kyc');
  const built = buildProfilePatch({
    fullName: String(formData.get('fullName') ?? ''),
    email: String(formData.get('email') ?? ''),
    dob: String(formData.get('dob') ?? ''),
    gender: String(formData.get('gender') ?? ''),
    languageCode: String(formData.get('languageCode') ?? ''),
    photoMediaId: String(formData.get('photoMediaId') ?? ''),
  });
  if (!built.ok) redirect(`/kyc?error=${built.error}`);
  try { await tenantClient().users.updateMe(built.value); }
  catch (e) { redirect(`/kyc?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'profile') : 'profile')}`); }
  revalidatePath('/kyc');
  redirect('/kyc?ok=profile');
}

export async function submitKycAction(formData: FormData): Promise<void> {
  await requireSession('/kyc');
  const built = buildKycSubmission({
    docTypeId: String(formData.get('docTypeId') ?? ''),
    mediaId: String(formData.get('docMediaId') ?? ''),
    docNoMasked: String(formData.get('docNoMasked') ?? ''),
  });
  if (!built.ok) redirect(`/kyc?error=${built.error}`);
  try { await tenantClient().kyc.submit(built.value, randomUUID()); }
  catch (e) { redirect(`/kyc?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'submit') : 'submit')}`); }
  revalidatePath('/kyc');
  redirect('/kyc?ok=submitted');
}
