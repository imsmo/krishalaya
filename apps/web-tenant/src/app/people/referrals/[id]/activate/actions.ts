'use server';
// apps/web-tenant/src/app/people/referrals/[id]/activate/actions.ts · W2736 / W2737 · activate a referral — PC-56 TENANT-10a.
// The API locks the referral, runs the state machine (signed_up → activated only), accrues the onboarding commission when
// the referrer is an active ambassador, and writes `referral.activated` with the reason — one transaction. Activation is
// idempotent by its state machine: a second attempt is REFERRAL_ILLEGAL_TRANSITION and changes nothing.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { REFERRALS_HREF, failureCodesFrom, isUuid } from '../../../../../features/ambassadors/console';

export async function activateReferralAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${REFERRALS_HREF}/${encodeURIComponent(id)}/activate`;
  await requireSession(base);
  if (!isUuid(id)) redirect(REFERRALS_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  let failed: string[] | null = null;
  try { await tenantClient().ambassadors.activateReferral(id, reason); }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.status === 403 ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(REFERRALS_HREF);
  redirect(`${base}?step=success`);
}
