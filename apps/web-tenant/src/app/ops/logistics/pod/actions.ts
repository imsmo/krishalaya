'use server';
// apps/web-tenant/src/app/ops/logistics/pod/actions.ts · W237 "Take next" (PC-56 TENANT-SW-a): claim the oldest awaiting POD review nobody
// holds — never one the viewer drove or dispatched — and open it. Claiming is not a money act and is audited server-side.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { POD_HREF } from '../../../../features/swa/console';

export async function podTakeNextAction(): Promise<void> {
  await requireSession(POD_HREF);
  let id: string | null = null;
  try { id = (await tenantClient().shipments.podTakeNext())?.id ?? null; }
  catch (e) { redirect(`${POD_HREF}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'generic') : 'generic')}`); }
  redirect(id ? `${POD_HREF}/${id}` : `${POD_HREF}?none=1`);
}
