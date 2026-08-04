'use server';
// apps/web-tenant/src/app/settings/webhooks/actions.ts · register / update / rotate-secret / delete a tenant's
// outbound webhook endpoint. The signing secret is generated + returned by the API ONCE (on register + rotate) and
// is surfaced to the operator a single time via a redirect flash — it is NEVER persisted by this app or logged.
// SSRF + event allow-list are enforced server-side; this layer only shapes the form + surfaces the API's error code.
// RBAC + audit live server-side (tenant.settings). 'use server' modules export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/settings/webhooks';

function fail(e: unknown): never {
  redirect(`${PATH}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
}

/** Read repeated `eventTypes` checkboxes/values into a de-duped non-empty array. */
function readEvents(formData: FormData): string[] {
  return Array.from(new Set(formData.getAll('eventTypes').map((v) => String(v).trim()).filter(Boolean)));
}

export async function registerWebhookAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const url = String(formData.get('url') ?? '').trim();
  const eventTypes = readEvents(formData);
  if (!/^https:\/\//i.test(url) || url.length > 500) redirect(`${PATH}?error=url`);
  if (eventTypes.length < 1) redirect(`${PATH}?error=events`);
  let secret = '';
  let id = '';
  try {
    const res = await tenantClient().webhooks.register({ url, eventTypes });
    secret = res.secret;
    id = res.id;
  } catch (e) {
    fail(e);
  }
  revalidatePath(PATH);
  // Surface the secret ONCE via the flash; the app does not store it.
  redirect(`${PATH}?secret=${encodeURIComponent(secret)}&secretFor=${encodeURIComponent(id)}`);
}

export async function updateWebhookAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  const patch: { eventTypes?: string[]; isActive?: boolean } = {};
  if (formData.get('toggleActive') != null) patch.isActive = String(formData.get('isActive') ?? '') === 'true';
  const events = readEvents(formData);
  if (formData.get('setEvents') != null) {
    if (events.length < 1) redirect(`${PATH}?error=events`);
    patch.eventTypes = events;
  }
  try {
    await tenantClient().webhooks.update(id, patch);
  } catch (e) {
    fail(e);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=updated`);
}

export async function rotateWebhookSecretAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  let secret = '';
  try {
    secret = (await tenantClient().webhooks.rotateSecret(id)).secret;
  } catch (e) {
    fail(e);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?secret=${encodeURIComponent(secret)}&secretFor=${encodeURIComponent(id)}`);
}

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try {
    await tenantClient().webhooks.remove(id);
  } catch (e) {
    fail(e);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=deleted`);
}
