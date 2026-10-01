'use server';
// apps/web-tenant/src/app/kyc/submit/actions.ts · W2321 / W2322 · the KYC form chain's submit — PC-56 TENANT-9a.
// Runs only from the REVIEW step (the API already answered every question); the writer re-takes the review inside its
// transaction and refuses with the same codes if anything moved. THE IDEMPOTENCY-KEY IS THE FORM'S (minted on the review
// page). Success drops the values from the URL — they are on the document and its audit row now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { carryValues } from '../../../features/forms/chain';
import { KYC_DESK_HREF, KYC_SUBMIT_HREF, SUBMIT_FIELDS, refusalCodesFrom } from '../../../features/kyc/desk';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function submitKycDocumentAction(formData: FormData): Promise<void> {
  await requireSession(KYC_SUBMIT_HREF);
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const values: Record<string, string | undefined> = {};
  for (const f of SUBMIT_FIELDS) values[f] = opt(formData.get(f));
  let savedId: string | null = null; let failed: string[] | null = null;
  try {
    savedId = (await tenantClient().kyc.deskSubmit(values as never, key)).id;
  } catch (e) { failed = e instanceof SdkError ? refusalCodesFrom(e.details, e.code || 'submit') : ['submit']; }
  if (failed) redirect(`${KYC_SUBMIT_HREF}?${carryValues('failure', values).query}&error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(KYC_DESK_HREF);
  redirect(`${KYC_SUBMIT_HREF}?step=success&saved=${encodeURIComponent(savedId!)}`);
}
