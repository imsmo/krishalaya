'use server';
// apps/web-tenant/src/app/comms/actions.ts · W2839's act (*"Export queue"*) — PC-56 TENANT-8e.
//
// [PC-27's `sendBroadcastAction` is GONE. It minted the Idempotency-Key INSIDE the action on every submit (F-17 —
// `randomUUID()` per click, so a double-submit messaged the whole cooperative twice while the header claimed the
// opposite), took the audience as free text (F-16) and ran on the support agent's key (F-19). A broadcast is now the
// form chain (`/comms/new`, *Save draft*) and the mutate chain (`/comms/[id]/act`, *Send broadcast* / cancel), each
// carrying the key its review or confirm page minted.]
//
// The export: dataset `communication.broadcasts` (the broadcast history, counts from the delivery log). The key is the
// form's — minted when the page rendered — so a double-click enqueues once; the plane also coalesces an open twin.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { COMMS_HREF, exportHref } from '../../features/comms/broadcasts';

export async function enqueueBroadcastsExportAction(formData: FormData): Promise<void> {
  await requireSession(COMMS_HREF);
  const back = String(formData.get('back') ?? '') === 'hub' ? '/channels/whatsapp' : COMMS_HREF;
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let id: string;
  try { id = (await tenantClient().notifications.enqueueBroadcastsExport(key)).id; }
  catch (e) { redirect(`${back}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'export') : 'export')}`); }
  redirect(exportHref(id));
}
