'use server';
// apps/web-gov/src/app/access/actions.ts · PC-56 GOV-1a — the access chain's REAL acts (W3198–W3200), GOV-1 Q4-A, on GOV-0's
// `/v1/gov/members/*` (each needs an Idempotency-Key — minted when the confirm form was shown, so a double submit is one act):
//   request  → any member (`authority.members.request`): a person by phone, a role, 1–12 months, a reason → `requested`
//   approve  → a head who is neither the requester nor the grantee — the API and the database refuse anyone else BY NAME
//   remove   → one head, at once, with a reason, never their own row; the person's sessions here end with their last role here
// Each lands on `?act=success&done=…` (what the SERVER did) or `?act=failure&error=<CODE>` (the named refusal; nothing changed). The page
// never decides the rule — it only offers; the API decides. 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { govClient } from '../../lib/api-client';
import { requireGov } from '../../lib/session';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (doing: string, e: unknown): never => {
  const code = e instanceof SdkError ? e.code : 'ACCESS_FAILED';
  redirect(`/access?act=failure&do=${doing}&error=${encodeURIComponent(code)}`);
};

export async function requestRoleAction(formData: FormData): Promise<void> {
  await requireGov('/access');
  let out;
  try {
    out = await govClient().gov.members.request({
      phone: str(formData, 'phone'), roleCode: str(formData, 'roleCode') as 'authority_head' | 'authority_officer',
      termMonths: Number(str(formData, 'termMonths')), reason: str(formData, 'reason'),
    }, str(formData, 'key'));
  } catch (e) { fail('request', e); }
  void out;
  redirect('/access?act=success&done=requested');
}

export async function approveRoleAction(formData: FormData): Promise<void> {
  await requireGov('/access');
  let out;
  try { out = await govClient().gov.members.approve(str(formData, 'id'), str(formData, 'key')); }
  catch (e) { fail('approve', e); }
  redirect(`/access?act=success&done=approved${out.expiresAt ? `&ends=${encodeURIComponent(out.expiresAt)}` : ''}`);
}

export async function removeRoleAction(formData: FormData): Promise<void> {
  await requireGov('/access');
  let out;
  try { out = await govClient().gov.members.remove(str(formData, 'id'), str(formData, 'reason'), str(formData, 'key')); }
  catch (e) { fail('remove', e); }
  redirect(`/access?act=success&done=removed&ended=${Number(out.sessionsEnded) || 0}`);
}
