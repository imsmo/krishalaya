'use server';
// apps/web-tenant/src/app/comms/actions.ts · comms-hub mutations (PC-27). Server-gated by comm.manage; the
// console only reflects (features/comms/hub mirrors the DTOs). A broadcast is Idempotency-Keyed (Law 3) so a
// double-submit can't message the whole tenant twice.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildBroadcast, buildTemplate } from '../../features/comms/hub';

function back(qs: string): never { redirect(`/comms?${qs}`); }

export async function sendBroadcastAction(formData: FormData): Promise<void> {
  await requireSession('/comms');
  const built = buildBroadcast({
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    audienceRoleCode: String(formData.get('audienceRoleCode') ?? ''),
  });
  if (!built.ok) back(`error=${built.error}`);
  try { await tenantClient().notifications.sendBroadcast(built.value, randomUUID()); }
  catch { back('error=broadcast'); }
  revalidatePath('/comms');
  back('ok=broadcast');
}

export async function upsertTemplateAction(formData: FormData): Promise<void> {
  await requireSession('/comms');
  const built = buildTemplate({
    eventCode: String(formData.get('eventCode') ?? ''),
    channel: String(formData.get('channel') ?? ''),
    languageCode: String(formData.get('languageCode') ?? ''),
    subject: String(formData.get('subject') ?? ''),
    body: String(formData.get('body') ?? ''),
    isActive: formData.get('isActive') === '1',
  });
  if (!built.ok) back(`error=tpl_${built.error}`);
  try { await tenantClient().notifications.upsertTemplate(built.value); }
  catch { back('error=template'); }
  revalidatePath('/comms');
  back('ok=template');
}
