'use server';
// apps/web-tenant/src/app/ops/labour/[id]/cancel/actions.ts · W2652 / W2653 · cancel a job — PC-56 TENANT-11b.
// The review's rules are re-run here against the API's own reason list, then by the API inside its transaction: the reason
// is recorded (cancel_reason_id + the employer's words for `other`), every worker on the job is told it, any escrow comes
// back to the employer and the platform fee is KEPT. The desk's cancel carries the employer's consent.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { CANCEL_KEYS, LABOUR_HREF, cancelHref, carried, consentFrom, failureCodesFrom, isUuid, jobHref, reviewCancel } from '../../../../../features/labour/console';

export async function cancelJobAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = cancelHref(id);
  await requireSession(base);
  if (!isUuid(id)) redirect(LABOUR_HREF);
  const values = carried(CANCEL_KEYS, (k) => formData.get(k));
  const keep = new URLSearchParams(values);
  const needsConsent = String(formData.get('needsConsent') ?? '') === '1';
  let reasons: Array<{ code: string; textRequired: boolean }> = [];
  try { reasons = (await tenantClient().labour.lookups()).cancelReasons ?? []; } catch { reasons = []; }
  const refusals = reviewCancel(values, reasons, needsConsent, values);
  if (refusals.length > 0) redirect(`${base}?step=failure&error=${encodeURIComponent([...new Set(refusals.map((r) => r.code))].join(','))}&${keep.toString()}`);
  const consent = consentFrom(values);
  let failed: string[] | null = null;
  try { await tenantClient().labour.cancelBooking(id, { reasonCode: values.reasonCode, ...(values.reasonText ? { reasonText: values.reasonText } : {}), ...(consent ? { consent } : {}) }); }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(LABOUR_HREF); revalidatePath(jobHref(id));
  redirect(`${base}?step=success`);
}
