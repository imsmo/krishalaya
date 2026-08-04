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
import { buildCreateListingInput } from '../../../features/listings/form';
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

/** Create the draft listing from the submitted form, then redirect to the listings list with a success flag. */
export async function createListingAction(formData: FormData): Promise<void> {
  await requireSession('/listings/new');
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const built = buildCreateListingInput({
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
    mediaIds: formData.getAll('mediaIds').map((m) => String(m)),
  });
  if (!built.ok) redirect(`/listings/new?error=${built.error}`);

  try {
    await tenantClient().listings.create(built.value, idempotencyKey);
  } catch (e) {
    const code = e instanceof SdkError ? e.code : 'CREATE_FAILED';
    redirect(`/listings/new?error=${encodeURIComponent(code)}`);
  }
  revalidatePath('/listings');
  redirect('/listings?created=1');
}
