'use server';
// apps/web-tenant/src/app/people/verification/[id]/claim-actions.ts · W158 "Skip (take next)" and Release — PC-56 TENANT-SW-c.
// Skip releases the claim with a CODED reason (`other` needs words ≥ 10) and opens the next document the reviewer may decide (never the
// same one again in this act). The key is the page's. Every refusal is named back on the document page.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { VERIFICATION_HREF, codesFrom, isIdemKey, isSkipReason, isUuid } from '../../../../features/swc/console';
import { docHref } from '../../../../features/kyc/desk';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return codesFrom(err?.code, err?.status, err?.details); };

export async function skipClaimAction(formData: FormData): Promise<void> {
  const claimId = String(formData.get('claimId') ?? ''); const docId = String(formData.get('docId') ?? '');
  await requireSession(isUuid(docId) ? docHref(docId) : VERIFICATION_HREF);
  const reasonCode = String(formData.get('reasonCode') ?? ''); const note = String(formData.get('note') ?? '').trim().slice(0, 300);
  const k = String(formData.get('idempotencyKey') ?? '');
  if (!isUuid(claimId) || !isSkipReason(reasonCode)) redirect(`${docHref(docId)}?error=SKIP_REASON_REQUIRED`);
  let next: string | null = null; let failed: string[] | null = null;
  try { next = (await tenantClient().kyc.skipClaim(claimId, { reasonCode, ...(note ? { note } : {}) }, isIdemKey(k) ? k : randomUUID())).documentId; }
  catch (e) { failed = codesOf(e); }
  if (failed) redirect(`${docHref(docId)}?error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(VERIFICATION_HREF);
  redirect(next ? docHref(next) : `${VERIFICATION_HREF}?empty=1`);
}

export async function releaseClaimAction(formData: FormData): Promise<void> {
  const claimId = String(formData.get('claimId') ?? ''); const docId = String(formData.get('docId') ?? '');
  await requireSession(isUuid(docId) ? docHref(docId) : VERIFICATION_HREF);
  let failed: string[] | null = null;
  try { if (isUuid(claimId)) await tenantClient().kyc.releaseClaim(claimId); } catch (e) { failed = codesOf(e); }
  if (failed) redirect(`${docHref(docId)}?error=${encodeURIComponent(failed.join(','))}`);
  revalidatePath(VERIFICATION_HREF);
  redirect(VERIFICATION_HREF);
}
