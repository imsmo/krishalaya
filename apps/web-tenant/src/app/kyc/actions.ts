'use server';
// apps/web-tenant/src/app/kyc/actions.ts · the staff member's own profile mutation. The only place the authed
// tenantClient() writes for the KYC/profile path. One Server Action, re-authorised SERVER-SIDE (the caller updates
// only their OWN profile — users.updateMe resolves the subject from the token, no id, no IDOR):
//   - updateProfileAction: PATCH /users/me with the PII-minimal validated patch (name/email/dob/gender/language/photo).
// The SDK exposes no Idempotency-Key on PATCH /users/me, so none is passed (a re-applied profile patch is naturally
// idempotent). KYC-submit is intentionally NOT here — see page.tsx: the SDK has no doc-type catalogue to pick a
// docTypeId, so submission is FLAGGED, not faked.
// 'use server' modules export ONLY async functions — validation lives in features/profile/form.ts.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildProfilePatch } from '../../features/profile/form';
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
