'use server';
// apps/web-tenant/src/app/offers/[id]/actions.ts · seller offer-negotiation mutations. The only place the authed
// tenantClient() writes for the offers path. Three Server Actions:
//   - acceptOfferAction: offers.accept(id) → the server creates the order and returns convertedOrderId; we
//     redirect straight to that order's detail (or back with a success flag if the id isn't returned yet).
//   - counterOfferAction: offers.counter(id, priceMinor) with a float-free per-unit minor-unit price (Law 2).
//   - rejectOfferAction: offers.reject(id).
// The API enforces per-party authorization (only the listing's seller) + the legal offer transition; an
// illegal/raced move (409) degrades to a message (Law 12). Note: the SDK's counter/accept/reject do NOT expose an
// Idempotency-Key (only offers.make does), so none is passed here. 'use server' modules export ONLY async fns.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { parseMajorToMinor } from '../../../features/listings/form';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/offers/${encodeURIComponent(id)}?${qs}`); }

export async function acceptOfferAction(formData: FormData): Promise<void> {
  await requireSession('/offers');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/offers');
  let convertedOrderId: string | null | undefined;
  try { convertedOrderId = (await tenantClient().offers.accept(id)).convertedOrderId; }
  catch (e) { back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'accept'}`); }
  revalidatePath(`/offers/${id}`);
  if (convertedOrderId) redirect(`/orders/${encodeURIComponent(convertedOrderId)}`);
  back(id, 'ok=accepted');
}

export async function counterOfferAction(formData: FormData): Promise<void> {
  await requireSession('/offers');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/offers');
  const priceMinor = parseMajorToMinor(String(formData.get('priceMajor') ?? ''));
  if (priceMinor === undefined || priceMinor === '0') back(id, 'error=price');
  try { await tenantClient().offers.counter(id, priceMinor); }
  catch (e) { back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'counter'}`); }
  revalidatePath(`/offers/${id}`);
  back(id, 'ok=countered');
}

export async function rejectOfferAction(formData: FormData): Promise<void> {
  await requireSession('/offers');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/offers');
  try { await tenantClient().offers.reject(id); }
  catch (e) { back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'reject'}`); }
  revalidatePath(`/offers/${id}`);
  back(id, 'ok=rejected');
}
