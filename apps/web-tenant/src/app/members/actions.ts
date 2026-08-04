'use server';
// apps/web-tenant/src/app/members/actions.ts · members-surface mutations (PC-28). Tier authoring is server-gated
// by membership.manage; cancel is manage-or-own (server-asserted). All under the `memberships` flag.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildTier } from '../../features/members/form';
import { SdkError } from '@krishalaya/sdk-js';

function back(qs: string): never { redirect(`/members?${qs}`); }

export async function createTierAction(formData: FormData): Promise<void> {
  await requireSession('/members');
  const built = buildTier({
    code: String(formData.get('code') ?? ''),
    name: String(formData.get('name') ?? ''),
    monthlyMajor: String(formData.get('monthlyMajor') ?? ''),
    annualMajor: String(formData.get('annualMajor') ?? ''),
  });
  if (!built.ok) back(`error=${built.error}`);
  try { await tenantClient().memberships.createTier(built.value); }
  catch (e) { back(`error=${e instanceof SdkError && e.status === 409 ? 'dup' : 'tier'}`); }
  revalidatePath('/members');
  back('ok=tier');
}

export async function setTierActiveAction(formData: FormData): Promise<void> {
  await requireSession('/members');
  const id = String(formData.get('id') ?? '').trim();
  const active = String(formData.get('active') ?? '') === '1';
  if (!id) back('error=tier');
  try { await tenantClient().memberships.setTierActive(id, active); }
  catch { back('error=tier'); }
  revalidatePath('/members');
  back(active ? 'ok=activated' : 'ok=deactivated');
}

export async function cancelMembershipAction(formData: FormData): Promise<void> {
  await requireSession('/members');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) back('error=cancel');
  try { await tenantClient().memberships.cancel(id); }
  catch (e) { back(`error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'cancel'}`); }
  revalidatePath('/members');
  back('ok=cancelled');
}
