'use server';
// apps/web-gov/src/app/applications/[id]/actions.ts · PC-56 GOV-2c — the act chain's REAL act (W3159–W3161), GOV-2 Q2-A and Q1-A, on GOV-2a's
// `POST /v1/gov/applications/:id/act` (an Idempotency-Key — minted when the confirm form was shown). The body is the act and, for a rejection,
// a listed reason and a sentence; for a clarification, a sentence — NOTHING else (approval carries no figure of any kind: Q1-A). The page
// never decides the rule — it only offers; the API refuses by name (GOV_DECIDER_IS_VERIFIER / _APPLICANT / _ASSISTER, GOV_NOT_VERIFIED, …).
// Lands on `?act=success&status=<the status the API returned>` or `?act=failure&error=<CODE>` (nothing changed). 'use server' files export
// ONLY async functions.
import { redirect } from 'next/navigation';
import { SdkError, type GovActInput, type GovRejectionCode } from '@krishalaya/sdk-js';
import { govClient } from '../../../lib/api-client';
import { requireGov } from '../../../lib/session';
import { actParam, isApplicationId } from '../../../features/gov2/applications';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function actOnApplicationAction(formData: FormData): Promise<void> {
  const id = str(formData, 'id');
  if (!isApplicationId(id)) redirect('/applications');
  await requireGov(`/applications/${id}`);
  const act = actParam(str(formData, 'act'));
  if (!act) redirect(`/applications/${id}`);
  const input: GovActInput = act === 'reject' ? { act, reasonCode: str(formData, 'reasonCode') as GovRejectionCode, note: str(formData, 'note') }
    : act === 'clarify' ? { act, note: str(formData, 'note') } : { act };
  let status = '';
  try { status = String((await govClient().gov.applications.act(id, input, str(formData, 'key'))).status); }
  catch (e) {
    const code = e instanceof SdkError ? e.code : 'ACT_FAILED';
    redirect(`/applications/${id}?do=${act}&act=failure&error=${encodeURIComponent(code)}`);
  }
  redirect(`/applications/${id}?do=${act}&act=success&status=${encodeURIComponent(status)}`);
}
