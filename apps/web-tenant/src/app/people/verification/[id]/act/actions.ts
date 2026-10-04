'use server';
// apps/web-tenant/src/app/people/verification/[id]/act/actions.ts (was /kyc/[docId]/act) · W2339 / W2340 · the verification mutate chain's act — PC-56 TENANT-9a / SW-c.
// verify · reject · request_more · reveal, re-judged by the API on the locked row. THE KEY IS THE CONFIRM PAGE'S. The
// reviewer's words never travel into a success URL; a reveal's success carries the 15-minute signed link the API minted
// AFTER it recorded the reveal (decision row + audit row).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { KYC_DESK_HREF, docHref, isDeskAct, refusalCodesFrom } from '../../../../../features/kyc/desk';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function kycActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const actRaw = String(formData.get('act') ?? '');
  const base = `${docHref(id)}/act`;
  await requireSession(base);
  if (!isDeskAct(actRaw)) redirect(`${base}?step=failure&error=ACT_UNKNOWN`);
  const act = actRaw as 'verify' | 'reject' | 'request_more' | 'reveal';
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const reasonCode = opt(formData.get('reasonCode'));
  const note = opt(formData.get('note'));
  let url: string | null = null; let failed: string[] | null = null;
  try {
    url = (await tenantClient().kyc.deskAct(id, act, { reasonCode, note }, key)).url;
  } catch (e) { failed = e instanceof SdkError ? refusalCodesFrom(e.details, e.code || 'act') : ['act']; }
  const keep = new URLSearchParams({ act }); if (reasonCode) keep.set('reasonCode', reasonCode);
  if (failed) redirect(`${base}?step=failure&${keep.toString()}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(KYC_DESK_HREF); revalidatePath(docHref(id));
  const done = new URLSearchParams({ step: 'success', act });
  if (url) done.set('link', url);
  redirect(`${base}?${done.toString()}`);
}
