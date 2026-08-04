'use server';
// apps/web-tenant/src/app/group-lots/actions.ts · FPO group-lot coordinator (group_lot.coordinate) mutations.
// Every write goes through the SDK to the audited, RBAC-gated + `group_lots`-flagged API, which owns the group-lot
// state machine, accumulates pledges, and computes the proportional settlement (float-free, zero-loss — Law 2).
// create + pledge carry a fresh Idempotency-Key (Law 3). Money is a bigint minor STRING; quantities are decimal
// strings. This layer only shapes + pre-validates the form and surfaces the API's typed error code.
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { validateCreate, validatePledge, validateSettle } from '../../features/group-lots/coordinator';

const PATH = '/group-lots';
const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };
const back = (id?: string) => id ? `${PATH}?lot=${encodeURIComponent(id)}` : PATH;

function fail(e: unknown, id?: string): never {
  const b = back(id);
  redirect(`${b}${b.includes('?') ? '&' : '?'}error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'save') : 'save')}`);
}

export async function createLotAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const productId = String(formData.get('productId') ?? '').trim();
  const targetQuantity = String(formData.get('targetQuantity') ?? '').trim();
  const unitCode = String(formData.get('unitCode') ?? '').trim();
  const pledgeDeadline = String(formData.get('pledgeDeadline') ?? '').trim();
  const coordinationFeeBps = opt(formData.get('coordinationFeeBps'));
  const bad = validateCreate({ productId, targetQuantity, unitCode, pledgeDeadline, coordinationFeeBps });
  if (bad) redirect(`${PATH}?error=${bad}`);
  let id: string | undefined;
  try {
    const lot = await tenantClient().groupLots.create({
      productId, targetQuantity, unitCode,
      pledgeDeadline: new Date(pledgeDeadline).toISOString(),
      coordinationFeeBps: coordinationFeeBps ? Number(coordinationFeeBps) : undefined,
    }, randomUUID());
    id = lot.id;
  } catch (e) { fail(e); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=create`);
}

export async function pledgeAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const farmerUserId = String(formData.get('farmerUserId') ?? '').trim();
  const quantity = String(formData.get('quantity') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  const bad = validatePledge({ farmerUserId, quantity });
  if (bad) redirect(`${back(id)}&error=${bad}`);
  try { await tenantClient().groupLots.pledge(id, { farmerUserId, quantity }, randomUUID()); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=pledge`);
}

export async function markReadyAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().groupLots.markReady(id); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=ready`);
}

export async function cancelLotAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  try { await tenantClient().groupLots.cancel(id); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=cancel`);
}

export async function settleAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('id') ?? '').trim();
  const grossProceedsMinor = String(formData.get('grossProceedsMinor') ?? '').trim();
  if (!id) redirect(`${PATH}?error=save`);
  const bad = validateSettle(grossProceedsMinor);
  if (bad) redirect(`${back(id)}&error=${bad}`);
  try { await tenantClient().groupLots.settle(id, grossProceedsMinor); } catch (e) { fail(e, id); }
  revalidatePath(PATH);
  redirect(`${back(id)}&ok=settle`);
}
