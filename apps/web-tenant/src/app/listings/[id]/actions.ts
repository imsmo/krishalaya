'use server';
// apps/web-tenant/src/app/listings/[id]/actions.ts · owner listing mutations. The only place the authed
// tenantClient() writes for the listing-manage path. Two Server Actions:
//   - publishListingAction: listings.publish(id). The API re-checks the state machine + ownership; an illegal
//     transition (e.g. already published, or a raced status) degrades to a message rather than crashing.
//   - changePriceAction: listings.changePrice(id, priceMinor, expectedVersion) — OPTIMISTIC CONCURRENCY. The
//     version comes from the rendered listing; if it changed underneath us the API rejects and we surface a
//     "reload, it changed" conflict message (never silently overwrite). Money is parsed float-free (Law 2).
// 'use server' modules export ONLY async functions — validation/types live in features/listings/{form,manage}.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { parseMajorToMinor } from '../../../features/listings/form';
import { priceErrorKey } from '../../../features/listings/manage';
import { boostErrorKey } from '../../../features/listings/boost';
import { SdkError } from '@krishalaya/sdk-js';

export async function publishListingAction(formData: FormData): Promise<void> {
  await requireSession('/listings');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/listings');
  try {
    await tenantClient().listings.publish(id);
  } catch (e) {
    const code = e instanceof SdkError ? e.code : 'PUBLISH_FAILED';
    redirect(`/listings/${encodeURIComponent(id)}?error=${encodeURIComponent(code === 'PUBLISH_FAILED' ? 'publish' : code)}`);
  }
  revalidatePath(`/listings/${id}`);
  revalidatePath('/listings');
  redirect(`/listings/${encodeURIComponent(id)}?ok=published`);
}

export async function changePriceAction(formData: FormData): Promise<void> {
  await requireSession('/listings');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/listings');
  const priceMinor = parseMajorToMinor(String(formData.get('priceMajor') ?? ''));
  const expectedVersion = Number.parseInt(String(formData.get('expectedVersion') ?? ''), 10);
  if (priceMinor === undefined || priceMinor === '0') redirect(`/listings/${encodeURIComponent(id)}?error=price`);
  if (!Number.isInteger(expectedVersion)) redirect(`/listings/${encodeURIComponent(id)}?error=conflict`);
  try {
    await tenantClient().listings.changePrice(id, priceMinor, expectedVersion);
  } catch (e) {
    const reason = priceErrorKey(e instanceof SdkError ? e.code : undefined);
    redirect(`/listings/${encodeURIComponent(id)}?error=${reason}`);
  }
  revalidatePath(`/listings/${id}`);
  revalidatePath('/listings');
  redirect(`/listings/${encodeURIComponent(id)}?ok=price`);
}

// PC-21b (2026-08-04): pay for a visibility boost straight from the wallet. The client sends ONLY the tier id —
// the server resolves the tier's authoritative price and moves money zero-sum (buyer wallet → platform fees),
// fail-closed on insufficient balance / frozen account. Idempotency-Key (Law 3) so a double-submit can't double-pay.
export async function boostListingAction(formData: FormData): Promise<void> {
  await requireSession('/listings');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/listings');
  const boostTierId = String(formData.get('boostTierId') ?? '').trim();
  if (!boostTierId) redirect(`/listings/${encodeURIComponent(id)}?error=boosttier`);
  try {
    await tenantClient().listings.payBoostFromWallet(id, boostTierId, randomUUID());
  } catch (e) {
    const reason = boostErrorKey(e instanceof SdkError ? e.code : undefined);
    redirect(`/listings/${encodeURIComponent(id)}?error=${reason}`);
  }
  revalidatePath(`/listings/${id}`);
  revalidatePath('/listings');
  redirect(`/listings/${encodeURIComponent(id)}?ok=boosted`);
}
