'use server';
// apps/web-tenant/src/app/twin/ask/actions.ts · W2805 / W2806 · "Ask your account desk" — PC-56 TENANT-12 (F-15).
// ONE row per tenant: the API answers a repeat ask with the first (`written: false`). The Idempotency-Key is minted on the confirm
// page. Nothing here reaches a plan, billing or a ticket.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { ASK_HREF, TWIN_HREF, failureCodesFrom } from '../../../features/twin/twin';

export async function askDeskAction(formData: FormData): Promise<void> {
  await requireSession(ASK_HREF);
  const key = String(formData.get('idem') ?? '');
  if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) redirect(`${ASK_HREF}?step=failure&error=unknown`);
  let out: { written: boolean; enabled: boolean; request: { id: string } | null } | null = null; let failed: string[] | null = null;
  try { out = await tenantClient().twin.requestAccess(key); }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status, e.details) : ['unknown']; }
  if (failed || !out) redirect(`${ASK_HREF}?step=failure&error=${encodeURIComponent((failed ?? ['unknown']).join(','))}`);
  revalidatePath(TWIN_HREF);
  redirect(`${ASK_HREF}?step=success&written=${out!.written ? '1' : '0'}&enabled=${out!.enabled ? '1' : '0'}${out!.request ? `&rid=${out!.request.id}` : ''}`);
}
