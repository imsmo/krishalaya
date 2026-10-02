'use server';
// apps/web-tenant/src/app/marketplace/auctions/new/actions.ts · W2350 / W2351 · schedule an auction — PC-56 TENANT-11a.
// The review's rules are re-run here (a hand-crafted POST gets the same refusals) and then by the API inside its own
// transaction (it reserves the listing, copies the lot and audits the create). THE KEY IS THE REVIEW PAGE'S (a double submit
// schedules one auction). On behalf: the seller is the listing's own seller (read on the review step) and the consent travels
// with the create. The values ride back to the failure page so its retry is a review of what was typed.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { CreateAuctionInput } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { AUCTIONS_HREF, FORM_KEYS, NEW_AUCTION_HREF, auctionEntries, carried, createBody, failureCodesFrom, isUuid, reviewAuction } from '../../../../features/auctions/console';

export async function createAuctionAction(formData: FormData): Promise<void> {
  await requireSession(NEW_AUCTION_HREF);
  const values = carried(FORM_KEYS, (k) => formData.get(k));
  const keep = new URLSearchParams(values);
  const entries = auctionEntries(values);
  const refusals = reviewAuction(entries, new Date());
  if (refusals.length > 0) redirect(`${NEW_AUCTION_HREF}?step=failure&error=${encodeURIComponent([...new Set(refusals.map((r) => r.code))].join(','))}&${keep.toString()}`);
  const seller = String(formData.get('sellerUserId') ?? '');
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let id: string | null = null; let failed: string[] | null = null;
  try {
    id = (await tenantClient().auctions.create(createBody(entries, isUuid(seller) ? seller : null) as unknown as CreateAuctionInput, key)).auctionId;
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown']; }
  if (failed) redirect(`${NEW_AUCTION_HREF}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(AUCTIONS_HREF);
  redirect(`${NEW_AUCTION_HREF}?step=success&id=${encodeURIComponent(id ?? '')}`);
}
