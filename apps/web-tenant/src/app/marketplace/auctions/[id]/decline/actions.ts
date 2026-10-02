'use server';
// apps/web-tenant/src/app/marketplace/auctions/[id]/decline/actions.ts · W2343 / W2344 · the seller's DECLINE — PC-56 TENANT-11a.
// POST /auctions/:id/cancel from awaiting_approval: the seller's right, or the desk's WITH the seller's recorded consent for
// THIS decision. The reason is sent to every bidder and recorded verbatim; every EMD comes back; the listing returns to sale.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { AUCTIONS_HREF, consentFrom, failureCodesFrom, isUuid, settleHref } from '../../../../../features/auctions/console';

export async function declineAuctionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${AUCTIONS_HREF}/${encodeURIComponent(id)}/decline`;
  await requireSession(base);
  if (!isUuid(id)) redirect(AUCTIONS_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  const consentChannel = String(formData.get('consentChannel') ?? ''); const consentMediaId = String(formData.get('consentMediaId') ?? '').trim(); const consentNote = String(formData.get('consentNote') ?? '').trim();
  const consent = consentFrom({ consentChannel, consentMediaId, consentNote });
  const keep = new URLSearchParams({ reason, ...(consentChannel ? { consentChannel } : {}), ...(consentMediaId ? { consentMediaId } : {}), ...(consentNote ? { consentNote } : {}) });
  let failed: string[] | null = null;
  try { await tenantClient().auctions.cancel(id, reason, consent ?? undefined); }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(AUCTIONS_HREF); revalidatePath(settleHref(id));
  redirect(`${base}?step=success`);
}
