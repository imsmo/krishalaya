'use server';
// apps/web-storefront/src/app/(platform)/auctions/[id]/actions.ts · place a bid. AUTHENTICATED (requireSession → anon to
// /login?next=). Placing a bid holds an earnest-money deposit (EMD) on the bidder's wallet ENTIRELY SERVER-SIDE
// (the client never moves money — Law 11); on loss the EMD is refunded server-side. The bid carries a
// randomUUID Idempotency-Key (Law 3) so a retry/double-click can't double-hold. Amount is parsed major→minor as
// an integer string (Law 2); the server is the authority on the real minimum/increment/EMD and rejects an
// invalid bid (we surface that generically — never auto-retry a money action). Re-read on return shows the truth.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { parseMajorToMinor } from '../../../../features/discovery/query';

export async function placeBidAction(formData: FormData): Promise<void> {
  const auctionId = String(formData.get('auctionId') ?? '');
  if (!auctionId) redirect('/auctions');
  const path = `/auctions/${encodeURIComponent(auctionId)}`;
  await requireSession(path);

  const amountMinor = parseMajorToMinor(String(formData.get('amount') ?? ''));
  if (!amountMinor || amountMinor === '0') redirect(`${path}?status=err`);

  try {
    await serverClient().auctions.placeBid(auctionId, amountMinor as string, randomUUID());
  } catch {
    redirect(`${path}?status=err`); // below min / ended / insufficient wallet for EMD / transient
  }
  revalidatePath(path);
  redirect(`${path}?status=bid`);
}

/** P1-7: watch / unwatch an auction (AUTHENTICATED → anon redirected to /login?next=). Idempotent + owner-scoped
 * server-side; watchers are notified when the auction closes (notification spine). A failure degrades to a notice
 * (Law 12) — never a crash. `intent` decides the direction so a single form handles both. */
export async function toggleWatchAction(formData: FormData): Promise<void> {
  const auctionId = String(formData.get('auctionId') ?? '');
  if (!auctionId) redirect('/auctions');
  const path = `/auctions/${encodeURIComponent(auctionId)}`;
  await requireSession(path);
  const intent = String(formData.get('intent') ?? 'watch'); // 'watch' | 'unwatch'
  try {
    if (intent === 'unwatch') await serverClient().auctions.unwatch(auctionId);
    else await serverClient().auctions.watch(auctionId);
  } catch {
    redirect(`${path}?status=watch_err`);
  }
  revalidatePath(path);
  redirect(`${path}?status=${intent === 'unwatch' ? 'unwatched' : 'watched'}`);
}
