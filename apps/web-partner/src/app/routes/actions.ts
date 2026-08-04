'use server';
// apps/web-partner/src/app/routes/actions.ts · Village Run route mutations — the ONLY place the partner session
// writes for the logistics/routes path. The platform API re-enforces logistics.manage + RLS; this builds the exact
// body and maps SdkError → a localized token. POST creates carry an Idempotency-Key (Law 3); PATCH/active do not
// auto-retry. 'use server' files export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildCreateRoute, buildUpdateRoute, buildSetActive, NetworkError } from '../../features/logistics/network';

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

export async function createRouteAction(formData: FormData): Promise<void> {
  await requirePartner();
  let body;
  try { body = buildCreateRoute({ defaultName: str(formData, 'defaultName'), runWeekday: opt(formData, 'runWeekday'), villageRegionIds: opt(formData, 'villageRegionIds'), vehicleId: opt(formData, 'vehicleId'), consolidationUserId: opt(formData, 'consolidationUserId') }); }
  catch (e) { redirect(`/routes?error=${inputErrorKey(e)}`); }
  let id: string | undefined;
  try { id = (await partnerClient().request<{ id: string }>('POST', 'logistics/routes', { body, idempotencyKey: randomUUID() })).data?.id; }
  catch (e) { redirect(`/routes?error=${apiErrorKey(e)}`); }
  revalidatePath('/routes');
  redirect(id ? `/routes/${enc(id)}?ok=created` : '/routes?ok=created');
}
export async function updateRouteAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/routes');
  let body;
  try { body = buildUpdateRoute({ defaultName: opt(formData, 'defaultName'), runWeekday: opt(formData, 'runWeekday'), villageRegionIds: opt(formData, 'villageRegionIds'), vehicleId: opt(formData, 'vehicleId'), consolidationUserId: opt(formData, 'consolidationUserId') }); }
  catch (e) { redirect(`/routes/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('PATCH', `logistics/routes/${enc(id)}`, { body }); }
  catch (e) { redirect(`/routes/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/routes/${id}`);
  redirect(`/routes/${enc(id)}?ok=updated`);
}
export async function setRouteActiveAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/routes');
  const isActive = str(formData, 'isActive') === 'true';
  try { await partnerClient().request('POST', `logistics/routes/${enc(id)}/active`, { body: buildSetActive(isActive) }); }
  catch (e) { redirect(`/routes/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/routes/${id}`);
  redirect(`/routes/${enc(id)}?ok=${isActive ? 'activated' : 'deactivated'}`);
}
