'use server';
// apps/web-tenant/src/app/channels/whatsapp/settings/edit/actions.ts · the opt-in policy save — W2843 / W2844 · PC-56 TENANT-8e.
// From the review step only; the key and the version the review saw ride in the form (a colleague's save in between is a
// typed 409 `WHATSAPP_POLICY_CHANGED`, never a silent overwrite).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { WA_POLICY_FORM_HREF, WA_SETTINGS_HREF } from '../../../../../features/comms/broadcasts';

export async function saveOptinPolicyAction(formData: FormData): Promise<void> {
  await requireSession(WA_POLICY_FORM_HREF);
  const sources = formData.getAll('sources').map(String).filter(Boolean);
  const consentStatement = String(formData.get('consentStatement') ?? '');
  const ev = Number(formData.get('expectVersion'));
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let failed: string | null = null;
  try { await tenantClient().notifications.saveWhatsAppOptinPolicy({ sources, consentStatement, ...(Number.isInteger(ev) && ev > 0 ? { expectVersion: ev } : {}) }, key); }
  catch (e) { failed = e instanceof SdkError ? (e.code || 'save') : 'save'; }
  if (failed) {
    const q = new URLSearchParams({ step: 'failure', error: failed, consentStatement });
    for (const s of sources) q.append('sources', s);
    redirect(`${WA_POLICY_FORM_HREF}?${q.toString()}`);
  }
  revalidatePath(WA_SETTINGS_HREF);
  redirect(`${WA_POLICY_FORM_HREF}?step=success`);
}
