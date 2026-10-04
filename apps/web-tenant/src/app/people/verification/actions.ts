'use server';
// apps/web-tenant/src/app/people/verification/actions.ts · W157 "Take next" — PC-56 TENANT-SW-c.
// Claims the oldest pending member document the reviewer may decide (FOR UPDATE SKIP LOCKED; never one they are recused from) for
// 15 minutes, then opens it. The key is the one the desk page minted. An empty queue says so; a refusal is named.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { VERIFICATION_HREF, codesFrom, isIdemKey } from '../../../features/swc/console';
import { docHref } from '../../../features/kyc/desk';

export async function takeNextAction(formData: FormData): Promise<void> {
  await requireSession(VERIFICATION_HREF);
  const k = String(formData.get('idempotencyKey') ?? '');
  let doc: string | null = null; let failed: string[] | null = null;
  try { doc = (await tenantClient().kyc.claimNext(isIdemKey(k) ? k : randomUUID())).documentId; }
  catch (e) { const err = e instanceof SdkError ? e : null; failed = codesFrom(err?.code, err?.status, err?.details); }
  if (failed) redirect(`${VERIFICATION_HREF}?error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(VERIFICATION_HREF);
  if (!doc) redirect(`${VERIFICATION_HREF}?empty=1`);
  redirect(docHref(doc));
}
