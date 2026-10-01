'use server';
// apps/web-tenant/src/app/content/templates/[id]/act/actions.ts · the template mutate chain's act — W2784/W2785 · PC-56
// TENANT-8a.
//
// The confirm step asked the API for the verdict and showed the reason box; this posts the act WITH ITS REASON under the
// key the confirm step minted (F-17: a double-click is one act). The server re-takes the verdict on the locked row — a
// confirm screen is not a token. The reason is dropped from the success URL (6d-5's rule): it is in the audit row now.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../../features/mutate/chain';
import { TEMPLATES_HREF, isOverrideAct, templateHref } from '../../../../../features/templates/override';

export async function templateActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  const act = String(formData.get('act') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const versionId = String(formData.get('versionId') ?? '').trim() || undefined;
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const path = `${templateHref(id)}/act`;
  await requireSession(path);
  if (!id) redirect(TEMPLATES_HREF);
  const values = { act, reason, versionId };
  if (!isOverrideAct(act) || reason.length === 0) redirect(`${path}?${carryValues('confirm', values).query}`);
  let to: string | null = null;
  try {
    to = (await tenantClient().notifications.templateAct(id, act, { reason, versionId }, key)).to;
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'act') : 'act';
    redirect(`${path}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(TEMPLATES_HREF); revalidatePath(templateHref(id));
  redirect(`${path}?step=success&act=${encodeURIComponent(act)}${to ? `&to=${encodeURIComponent(to)}` : ''}`);
}
