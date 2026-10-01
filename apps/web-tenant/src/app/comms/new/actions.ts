'use server';
// apps/web-tenant/src/app/comms/new/actions.ts · the broadcast form chain's submit — W2843 / W2844 · PC-56 TENANT-8e.
// Runs only from the REVIEW step, which already asked the API every question; the writer re-takes the review under the
// row lock and refuses with the same codes if anything moved. THE IDEMPOTENCY-KEY IS THE FORM'S (F-17). Success drops the
// words from the URL — they are on the draft and its audit row now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { carryValues } from '../../../features/forms/chain';
import { BROADCAST_FIELDS, BROADCAST_FORM_HREF, COMMS_HREF, MAX_CARRIED_BROADCAST } from '../../../features/comms/broadcasts';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function saveBroadcastDraftAction(formData: FormData): Promise<void> {
  await requireSession(BROADCAST_FORM_HREF);
  const id = opt(formData.get('id'));
  const key = opt(formData.get('idempotencyKey')) ?? randomUUID();
  const values: Record<string, string | undefined> = {};
  for (const f of BROADCAST_FIELDS) values[f] = opt(formData.get(f));
  let savedId: string | null = null; let failed: string | null = null;
  try {
    savedId = (await tenantClient().notifications.saveBroadcastDraft({ title: values.title, body: values.body, audienceRoleCode: values.audienceRoleCode, scheduledAt: values.scheduledAt }, key, id)).broadcast.id;
  } catch (e) { failed = e instanceof SdkError ? (e.code || 'save') : 'save'; }
  if (failed) redirect(`${BROADCAST_FORM_HREF}?${carryValues('failure', { ...values, ...(id ? { id } : {}) }, MAX_CARRIED_BROADCAST).query}&error=${encodeURIComponent(failed)}`);
  revalidatePath(COMMS_HREF);
  redirect(`${BROADCAST_FORM_HREF}?step=success&saved=${encodeURIComponent(savedId!)}`);
}
