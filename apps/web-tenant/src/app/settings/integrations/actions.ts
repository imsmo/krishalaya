'use server';
// apps/web-tenant/src/app/settings/integrations/actions.ts · connect/disconnect a tenant's third-party provider.
// The raw credential is forwarded to the API which vaults it server-side (the app never persists/logs it); only a
// ref is stored. RBAC + audit are server-side (tenant.settings). 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/settings/integrations';
const PROVIDER = /^[a-z][a-z0-9_]{1,59}$/;

export async function connectIntegrationAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const providerCode = String(formData.get('providerCode') ?? '').trim();
  const credential = String(formData.get('credential') ?? '');
  const sandbox = String(formData.get('sandbox') ?? '') === 'on';
  if (!PROVIDER.test(providerCode)) redirect(`${PATH}?error=provider`);
  if (credential.length < 1 || credential.length > 8000) redirect(`${PATH}?error=credential`);
  try {
    await tenantClient().integrations.connect({ providerCode, credential, config: { sandbox } }, randomUUID());
  } catch (e) {
    redirect(`${PATH}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=connected`);
}

export async function disconnectIntegrationAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const providerCode = String(formData.get('providerCode') ?? '').trim();
  if (!providerCode) redirect(`${PATH}?error=save`);
  try {
    await tenantClient().integrations.disconnect(providerCode);
  } catch (e) {
    redirect(`${PATH}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=disconnected`);
}
