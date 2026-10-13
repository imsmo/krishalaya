'use server';
// apps/web-storefront/src/app/(platform)/offers/[id]/actions.ts · buyer negotiation actions on an offer + a "message seller"
// entry to chat. All AUTHENTICATED (requireSession). The per-party authorization (you are the offer's buyer) and
// the legal state transition are enforced SERVER-SIDE — we only reflect what's allowed. counter/accept/reject
// expose no Idempotency-Key in the SDK (the state machine guards them); conversations.open does (Law 3). Money is
// parsed major→minor as an integer string (Law 2). Accept converts the offer into an order server-side; we send
// the buyer to that order. Errors are generic + never auto-retried.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { parseMajorToMinor } from '../../../../features/discovery/query';

function offerPath(id: string): string { return `/offers/${encodeURIComponent(id)}`; }

export async function acceptOfferAction(formData: FormData): Promise<void> {
  const id = String(formData.get('offerId') ?? '');
  if (!id) redirect('/offers');
  await requireSession(offerPath(id));
  let convertedOrderId: string | null = null;
  try {
    const offer = await serverClient().offers.accept(id);
    convertedOrderId = offer.convertedOrderId ?? null;
  } catch { redirect(`${offerPath(id)}?status=err`); }
  redirect(convertedOrderId ? `/orders/${encodeURIComponent(convertedOrderId)}` : `${offerPath(id)}?status=accepted`);
}

export async function counterOfferAction(formData: FormData): Promise<void> {
  const id = String(formData.get('offerId') ?? '');
  if (!id) redirect('/offers');
  await requireSession(offerPath(id));
  const priceMinor = parseMajorToMinor(String(formData.get('counterPrice') ?? ''));
  if (!priceMinor || priceMinor === '0') redirect(`${offerPath(id)}?status=err`);
  try { await serverClient().offers.counter(id, priceMinor as string); }
  catch { redirect(`${offerPath(id)}?status=err`); }
  redirect(`${offerPath(id)}?status=countered`);
}

export async function rejectOfferAction(formData: FormData): Promise<void> {
  const id = String(formData.get('offerId') ?? '');
  if (!id) redirect('/offers');
  await requireSession(offerPath(id));
  try { await serverClient().offers.reject(id); }
  catch { redirect(`${offerPath(id)}?status=err`); }
  redirect(`${offerPath(id)}?status=rejected`);
}

/** Open (or reuse) a chat with the listing's seller, then go to the thread. Seller id is resolved server-side. */
export async function messageSellerAction(formData: FormData): Promise<void> {
  const id = String(formData.get('offerId') ?? '');
  const listingId = String(formData.get('listingId') ?? '');
  if (!id || !listingId) redirect('/offers');
  await requireSession(offerPath(id));
  let conversationId: string | null = null;
  try {
    const listing = await serverClient().listings.get(listingId);
    const convo = await serverClient().conversations.open(
      { contextType: 'direct', contextId: listingId, participantUserIds: [listing.sellerUserId] },
      randomUUID(),
    );
    conversationId = convo.id;
  } catch { redirect(`${offerPath(id)}?status=err`); }
  redirect(`/messages/${encodeURIComponent(conversationId as string)}`);
}
