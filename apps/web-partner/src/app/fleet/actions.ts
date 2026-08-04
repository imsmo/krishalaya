'use server';
// apps/web-partner/src/app/fleet/actions.ts · 3PL fleet-setup mutations — the ONLY place the partner session writes
// for the logistics carrier/vehicle/pickup-slot paths. The platform API re-enforces logistics.manage + RLS; this
// builds the exact body and maps SdkError → a localized token. POST creates carry an Idempotency-Key (Law 3);
// PATCH/active do not auto-retry. 'use server' files export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import {
  buildCreatePartner, buildUpdatePartner, buildCreateVehicle, buildUpdateVehicle, buildCreateSlot, buildSetActive, FleetError,
} from '../../features/logistics/fleet';

function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'conflict';
  }
  return 'generic';
}
const inputErrorKey = (e: unknown, fallback = 'generic') => (e instanceof FleetError ? e.fieldKey : fallback);
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const opt = (fd: FormData, k: string) => (fd.has(k) ? String(fd.get(k) ?? '') : undefined);

/* ---- carriers (logistics/partners) ---- */
export async function createPartnerAction(formData: FormData): Promise<void> {
  await requirePartner();
  let body;
  try { body = buildCreatePartner({ partnerKind: str(formData, 'partnerKind'), defaultName: str(formData, 'defaultName'), providerCode: opt(formData, 'providerCode'), supportsColdChain: opt(formData, 'supportsColdChain') }); }
  catch (e) { redirect(`/fleet?error=${inputErrorKey(e)}`); }
  let id: string | undefined;
  try { id = (await partnerClient().request<{ id: string }>('POST', 'logistics/partners', { body, idempotencyKey: randomUUID() })).data?.id; }
  catch (e) { redirect(`/fleet?error=${apiErrorKey(e)}`); }
  revalidatePath('/fleet');
  redirect(id ? `/fleet/carriers/${enc(id)}?ok=created` : '/fleet?ok=created');
}
export async function updatePartnerAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/fleet');
  let body;
  try { body = buildUpdatePartner({ defaultName: opt(formData, 'defaultName'), providerCode: opt(formData, 'providerCode'), supportsColdChain: opt(formData, 'supportsColdChain') }); }
  catch (e) { redirect(`/fleet/carriers/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('PATCH', `logistics/partners/${enc(id)}`, { body }); }
  catch (e) { redirect(`/fleet/carriers/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/fleet/carriers/${id}`);
  redirect(`/fleet/carriers/${enc(id)}?ok=updated`);
}
export async function setPartnerActiveAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/fleet');
  const isActive = str(formData, 'isActive') === 'true';
  try { await partnerClient().request('POST', `logistics/partners/${enc(id)}/active`, { body: buildSetActive(isActive) }); }
  catch (e) { redirect(`/fleet/carriers/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/fleet/carriers/${id}`);
  redirect(`/fleet/carriers/${enc(id)}?ok=${isActive ? 'activated' : 'deactivated'}`);
}

/* ---- vehicles (logistics/vehicles) ---- */
export async function createVehicleAction(formData: FormData): Promise<void> {
  await requirePartner();
  let body;
  try { body = buildCreateVehicle({ partnerId: str(formData, 'partnerId'), regNo: str(formData, 'regNo'), capacityKg: opt(formData, 'capacityKg'), isRefrigerated: opt(formData, 'isRefrigerated') }); }
  catch (e) { redirect(`/fleet/vehicles?error=${inputErrorKey(e)}`); }
  let id: string | undefined;
  try { id = (await partnerClient().request<{ id: string }>('POST', 'logistics/vehicles', { body, idempotencyKey: randomUUID() })).data?.id; }
  catch (e) { redirect(`/fleet/vehicles?error=${apiErrorKey(e)}`); }
  revalidatePath('/fleet/vehicles');
  redirect(id ? `/fleet/vehicles/${enc(id)}?ok=created` : '/fleet/vehicles?ok=created');
}
export async function updateVehicleAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/fleet/vehicles');
  let body;
  try { body = buildUpdateVehicle({ capacityKg: opt(formData, 'capacityKg'), isRefrigerated: opt(formData, 'isRefrigerated') }); }
  catch (e) { redirect(`/fleet/vehicles/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('PATCH', `logistics/vehicles/${enc(id)}`, { body }); }
  catch (e) { redirect(`/fleet/vehicles/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/fleet/vehicles/${id}`);
  redirect(`/fleet/vehicles/${enc(id)}?ok=updated`);
}
export async function setVehicleActiveAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/fleet/vehicles');
  const isActive = str(formData, 'isActive') === 'true';
  try { await partnerClient().request('POST', `logistics/vehicles/${enc(id)}/active`, { body: buildSetActive(isActive) }); }
  catch (e) { redirect(`/fleet/vehicles/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/fleet/vehicles/${id}`);
  redirect(`/fleet/vehicles/${enc(id)}?ok=${isActive ? 'activated' : 'deactivated'}`);
}

/* ---- pickup slots (logistics/pickup-slots) ---- */
export async function createSlotAction(formData: FormData): Promise<void> {
  await requirePartner();
  let body;
  try { body = buildCreateSlot({ weekday: str(formData, 'weekday'), startTime: str(formData, 'startTime'), endTime: str(formData, 'endTime') }); }
  catch (e) { redirect(`/fleet/slots?error=${inputErrorKey(e)}`); }
  let id: string | undefined;
  try { id = (await partnerClient().request<{ id: string }>('POST', 'logistics/pickup-slots', { body, idempotencyKey: randomUUID() })).data?.id; }
  catch (e) { redirect(`/fleet/slots?error=${apiErrorKey(e)}`); }
  revalidatePath('/fleet/slots');
  redirect(id ? `/fleet/slots/${enc(id)}?ok=created` : '/fleet/slots?ok=created');
}
export async function updateSlotAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/fleet/slots');
  // a slot edit reuses the create builder shape (weekday + both times), enforcing start<end again.
  let body;
  try { body = buildCreateSlot({ weekday: str(formData, 'weekday'), startTime: str(formData, 'startTime'), endTime: str(formData, 'endTime') }); }
  catch (e) { redirect(`/fleet/slots/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('PATCH', `logistics/pickup-slots/${enc(id)}`, { body }); }
  catch (e) { redirect(`/fleet/slots/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/fleet/slots/${id}`);
  redirect(`/fleet/slots/${enc(id)}?ok=updated`);
}
export async function setSlotActiveAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/fleet/slots');
  const isActive = str(formData, 'isActive') === 'true';
  try { await partnerClient().request('POST', `logistics/pickup-slots/${enc(id)}/active`, { body: buildSetActive(isActive) }); }
  catch (e) { redirect(`/fleet/slots/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/fleet/slots/${id}`);
  redirect(`/fleet/slots/${enc(id)}?ok=${isActive ? 'activated' : 'deactivated'}`);
}
