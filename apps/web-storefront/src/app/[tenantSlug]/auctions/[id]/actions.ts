'use server';
// apps/web-storefront/src/app/[tenantSlug]/auctions/[id]/actions.ts · PC-56 STORE-2c · C6 — place a bid (W278), watch / unwatch. AUTHENTICATED
// (requireSession → this store's sign-in). The bid stays the API's `POST /v1/auctions/:id/bids` — session-only, Idempotency-Key minted when the
// form RENDERED (a double-tap of the same form is one bid), the EMD held server-side exactly as the API's rule says. The typed amount is parsed
// with the auction's OWN currency exponent from the public read (never two decimals by default) — string math, never a float. A refusal is
// named (below the minimum / ended / the deposit cannot be held / entry paused) and the page re-reads the truth.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient, serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { bidMinor } from '../../../../features/store2c/auction';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const BID_REFUSALS: Record<string, string> = {
  AUCTION_BID_TOO_LOW: 'too_low', BID_TOO_LOW: 'too_low', AUCTION_ENDED: 'ended', AUCTION_NOT_BIDDABLE: 'ended', ALREADY_HIGH_BIDDER: 'leading',
  AUCTION_ALREADY_HIGH_BIDDER: 'leading', WALLET_INSUFFICIENT_BALANCE: 'emd', AUCTION_ENTRY_PAUSED: 'paused', SELLER_CANNOT_BID: 'seller',
};

export async function placeBidAction(fd: FormData): Promise<void> {
  const slug = String(fd.get('slug') ?? ''); const auctionId = String(fd.get('auctionId') ?? ''); const key = String(fd.get('idempotencyKey') ?? '');
  if (!SLUG.test(slug) || !UUID.test(auctionId)) redirect('/');
  const path = `/${encodeURIComponent(slug)}/auctions/${encodeURIComponent(auctionId)}`;
  await requireSession(path);
  let exponent: number | null = null;
  try { exponent = (await publicClient(slug).storefront.auction(auctionId)).exponent; } catch { exponent = null; }
  const amountMinor = bidMinor(fd.get('amount'), exponent);
  if (!amountMinor || !UUID.test(key)) redirect(`${path}?status=bad_amount`);
  let refusal: string | null = null;
  try { await serverClient(slug).auctions.placeBid(auctionId, amountMinor as string, key); }
  catch (e) { refusal = e instanceof SdkError ? (BID_REFUSALS[e.code] ?? 'failed') : 'failed'; }
  revalidatePath(path);
  redirect(`${path}?status=${refusal ?? 'bid'}`);
}

export async function toggleWatchAction(fd: FormData): Promise<void> {
  const slug = String(fd.get('slug') ?? ''); const auctionId = String(fd.get('auctionId') ?? '');
  if (!SLUG.test(slug) || !UUID.test(auctionId)) redirect('/');
  const path = `/${encodeURIComponent(slug)}/auctions/${encodeURIComponent(auctionId)}`;
  await requireSession(path);
  const intent = String(fd.get('intent') ?? 'watch');
  try {
    if (intent === 'unwatch') await serverClient(slug).auctions.unwatch(auctionId);
    else await serverClient(slug).auctions.watch(auctionId);
  } catch { redirect(`${path}?status=watch_err`); }
  revalidatePath(path);
  redirect(`${path}?status=${intent === 'unwatch' ? 'unwatched' : 'watched'}`);
}
