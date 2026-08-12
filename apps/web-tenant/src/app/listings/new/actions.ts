'use server';
// apps/web-tenant/src/app/listings/new/actions.ts · the ONLY place the authed tenantClient() is invoked for the
// new-listing write path. Three Server Actions:
//   - requestUpload / confirmUpload: the media two-step (the browser PUTs the raw bytes straight to S3 in
//     between — those bytes never touch this server, and the session token never reaches the browser). Both are
//     mutations and carry an Idempotency-Key (Law 3) so a retry can't mint duplicate assets.
//   - createListing: validates the raw form (pure buildCreateListingInput), then listings.create with the form's
//     stable Idempotency-Key (so a double-submit/refresh never creates two drafts), then redirects to /listings.
// 'use server' modules export ONLY async functions — types/validation live in features/listings/form.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildCreateListingInput, preservedQuery } from '../../../features/listings/form';
import { SdkError, type MediaKind, type MediaUploadTicket } from '@krishalaya/sdk-js';

/** Step 1: mint a presigned PUT ticket (authed). The browser uploads the bytes to ticket.uploadUrl itself. */
export async function requestUploadAction(input: { kind: MediaKind; mimeType: string; declaredBytes: number }): Promise<MediaUploadTicket> {
  await requireSession('/listings/new');
  return tenantClient().media.requestUpload(input, randomUUID());
}

/** Step 3: confirm the uploaded asset's real size + sha256 (+image dims). Returns the confirmed mediaId. */
export async function confirmUploadAction(mediaId: string, input: { bytes: number; sha256: string; width?: number; height?: number }): Promise<{ mediaId: string; status: string }> {
  await requireSession('/listings/new');
  return tenantClient().media.confirmUpload(mediaId, input, randomUUID());
}

/** Create the draft listing (own, or on a MEMBER's behalf — consent-gated server-side), then land on the
 *  draft's detail page: that page IS the review-before-submit (W2358 met as a real state — the next thing that
 *  should happen to a draft is somebody reading it, then Submit for QC). On any refusal the member's typed
 *  values are PRESERVED in the redirect (W2357's law — "values you entered are preserved, nothing was saved"). */
export async function createListingAction(formData: FormData): Promise<void> {
  await requireSession('/listings/new');
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const fields = {
    product: String(formData.get('product') ?? ''),
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    quantityTotal: String(formData.get('quantityTotal') ?? ''),
    minOrderQty: String(formData.get('minOrderQty') ?? ''),
    priceMajor: String(formData.get('priceMajor') ?? ''),
    saleType: String(formData.get('saleType') ?? ''),
    organicClaim: String(formData.get('organicClaim') ?? ''),
    visibility: String(formData.get('visibility') ?? ''),
    pincode: String(formData.get('pincode') ?? ''),
    regionId: String(formData.get('regionId') ?? ''),
    harvestDate: String(formData.get('harvestDate') ?? ''),
    member: String(formData.get('member') ?? ''),
    memberName: String(formData.get('memberName') ?? ''),
  };
  const mediaIds = formData.getAll('mediaIds').map((m) => String(m));
  const back = (error: string) => `/listings/new?${preservedQuery(fields, mediaIds)}&error=${encodeURIComponent(error)}`;

  const built = buildCreateListingInput({ ...fields, mediaIds });
  if (!built.ok) redirect(back(built.error));

  let id = '';
  try {
    if (fields.member) {
      // On behalf of a member: the server checks the member's recorded consent BEFORE creating anything and
      // records the staff hand (created_by) so QC's no-self-review sees it.
      ({ id } = await tenantClient().listings.createOnBehalf({ ...built.value, sellerUserId: fields.member }, idempotencyKey));
    } else {
      ({ id } = await tenantClient().listings.create(built.value, idempotencyKey));
    }
  } catch (e) {
    const code = e instanceof SdkError ? e.code : 'CREATE_FAILED';
    redirect(back(code === 'LISTING_ONBEHALF_CONSENT' ? 'consent' : code));
  }
  revalidatePath('/listings');
  redirect(`/listings/${encodeURIComponent(id)}?ok=created`);
}
