'use server';
// apps/web-tenant/src/app/auctions/actions.ts · seller auction mutations. The only place the authed tenantClient()
// writes for the auctions path. Three Server Actions:
//   - createAuctionAction: converts the datetime-local inputs to ISO, validates + assembles via buildCreateAuction
//     (money float-free, Law 2; end strictly after start), then auctions.create with an Idempotency-Key (Law 3).
//   - approveAuctionAction / cancelAuctionAction: seller/moderator transitions (auctions.approve/cancel). The API
//     re-checks the state machine + ownership; an illegal/raced move (409) degrades to a message (Law 12).
// 'use server' modules export ONLY async functions — validation lives in features/auctions/manage.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildCreateAuction } from '../../features/auctions/manage';
import { SdkError } from '@krishalaya/sdk-js';

/** datetime-local value ("2026-07-01T10:00") → ISO 8601, or '' when blank/unparseable. */
function toIso(local: string): string {
  const v = local.trim();
  if (!v) return '';
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
}

export async function createAuctionAction(formData: FormData): Promise<void> {
  await requireSession('/auctions');
  const built = buildCreateAuction({
    listingId: String(formData.get('listingId') ?? ''),
    kind: String(formData.get('kind') ?? ''),
    startPriceMajor: String(formData.get('startPriceMajor') ?? ''),
    reservePriceMajor: String(formData.get('reservePriceMajor') ?? ''),
    minIncrementMajor: String(formData.get('minIncrementMajor') ?? ''),
    emdMajor: String(formData.get('emdMajor') ?? ''),
    startsAtIso: toIso(String(formData.get('startsAt') ?? '')),
    endsAtIso: toIso(String(formData.get('endsAt') ?? '')),
    requiresSellerApproval: String(formData.get('requiresSellerApproval') ?? ''),
  });
  if (!built.ok) redirect(`/auctions?error=${built.error}`);
  let id: string | undefined;
  try { id = (await tenantClient().auctions.create(built.value, randomUUID())).auctionId; }
  catch (e) { redirect(`/auctions?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'create') : 'create')}`); }
  revalidatePath('/auctions');
  redirect(id ? `/auctions/${encodeURIComponent(id)}?ok=created` : '/auctions?ok=created');
}

async function transition(formData: FormData, kind: 'approve' | 'cancel'): Promise<void> {
  await requireSession('/auctions');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/auctions');
  try {
    if (kind === 'approve') await tenantClient().auctions.approve(id);
    else await tenantClient().auctions.cancel(id);
  } catch (e) {
    const code = e instanceof SdkError && e.status === 409 ? 'illegal' : kind;
    redirect(`/auctions/${encodeURIComponent(id)}?error=${code}`);
  }
  revalidatePath(`/auctions/${id}`);
  revalidatePath('/auctions');
  redirect(`/auctions/${encodeURIComponent(id)}?ok=${kind}`);
}

export async function approveAuctionAction(formData: FormData): Promise<void> { return transition(formData, 'approve'); }
export async function cancelAuctionAction(formData: FormData): Promise<void> { return transition(formData, 'cancel'); }
