'use server';
// apps/web-tenant/src/app/comms/[id]/act/actions.ts · the broadcast mutate chain's act — W2846 / W2847 · PC-56 TENANT-8e.
// Send or cancel, with the reason typed on the confirm page and the key that page minted (F-17). The API re-takes the
// verdict under the row lock; a refusal comes back with its codes, printed as sentences on the failure step.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { COMMS_HREF, broadcastActPath, broadcastHref, isBroadcastAct } from '../../../../features/comms/broadcasts';

export async function broadcastActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(COMMS_HREF);
  await requireSession(broadcastActPath(id));
  const actRaw = String(formData.get('act') ?? '');
  if (!isBroadcastAct(actRaw)) redirect(broadcastHref(id));
  const act = actRaw;
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let to: string | null = null; let failed: { code: string; refusals: string[] } | null = null;
  try { to = (await tenantClient().notifications.broadcastAct(id, act, reason, key)).broadcast.status; }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    const refusals = Array.isArray(err?.details?.refusals) ? (err!.details!.refusals as unknown[]).map(String) : [];
    failed = { code: err?.code || 'act', refusals };
  }
  const q = (o: Record<string, string>) => new URLSearchParams({ act, ...o }).toString();
  if (failed) redirect(`${broadcastActPath(id)}?${q({ step: 'failure', error: failed.code, refusals: failed.refusals.join(','), reason })}`);
  revalidatePath(COMMS_HREF); revalidatePath(broadcastHref(id));
  redirect(`${broadcastActPath(id)}?${q({ step: 'success', to: to ?? '' })}`);
}
