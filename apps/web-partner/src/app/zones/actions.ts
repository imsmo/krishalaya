'use server';
// apps/web-partner/src/app/zones/actions.ts · delivery serviceability-zone mutations — the ONLY place the partner
// session writes for the logistics/zones path. The platform API re-enforces logistics.manage + RLS; this builds the
// exact body and maps SdkError → a localized token. POST creates carry an Idempotency-Key (Law 3); PATCH/active do
// not auto-retry. 'use server' files export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildCreateZone, buildUpdateZone, buildSetActive, NetworkError } from '../../features/logistics/network';

function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'conflict';
  }
  return 'generic';
}
const inputErrorKey = (e: unknown, fallback = 'generic') => (e instanceof NetworkError ? e.fieldKey : fallback);
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const opt = (fd: FormData, k: string) => (fd.has(k) ? String(fd.get(k) ?? '') : undefined);

export async function createZoneAction(formData: FormData): Promise<void> {
  await requirePartner();
  let body;
  try { body = buildCreateZone({ defaultName: str(formData, 'defaultName'), pincodes: opt(formData, 'pincodes'), regionIds: opt(formData, 'regionIds'), chargeDefinitionId: opt(formData, 'chargeDefinitionId') }); }
  catch (e) { redirect(`/zones?error=${inputErrorKey(e)}`); }
  let id: string | undefined;
  try { id = (await partnerClient().request<{ id: string }>('POST', 'logistics/zones', { body, idempotencyKey: randomUUID() })).data?.id; }
  catch (e) { redirect(`/zones?error=${apiErrorKey(e)}`); }
  revalidatePath('/zones');
  redirect(id ? `/zones/${enc(id)}?ok=created` : '/zones?ok=created');
}
export async function updateZoneAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/zones');
  let body;
  try { body = buildUpdateZone({ defaultName: opt(formData, 'defaultName'), pincodes: opt(formData, 'pincodes'), regionIds: opt(formData, 'regionIds'), chargeDefinitionId: opt(formData, 'chargeDefinitionId') }); }
  catch (e) { redirect(`/zones/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('PATCH', `logistics/zones/${enc(id)}`, { body }); }
  catch (e) { redirect(`/zones/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/zones/${id}`);
  redirect(`/zones/${enc(id)}?ok=updated`);
}
export async function setZoneActiveAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/zones');
  const isActive = str(formData, 'isActive') === 'true';
  try { await partnerClient().request('POST', `logistics/zones/${enc(id)}/active`, { body: buildSetActive(isActive) }); }
  catch (e) { redirect(`/zones/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/zones/${id}`);
  redirect(`/zones/${enc(id)}?ok=${isActive ? 'activated' : 'deactivated'}`);
}
