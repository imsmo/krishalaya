// apps/web-storefront/src/app/(platform)/auctions/bids/page.tsx · PC-56 STORE-3c · C1 — THE PLATFORM'S /auctions/bids IS A DOOR. A buyer's bids live
// under the organisation's chrome at /<slug>/auctions/bids (canon W296); a signed-in buyer is sent to the store their session was minted for
// (one store per session), carrying the cursor; an anonymous visitor signs in first (requireSession). If the session's store cannot be read:
// said, with a Retry — never a guessed store.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { sessionStoreSlug, carryQuery } from '../../../../lib/store-door';
import { StoreDoorError } from '../../../../components/StoreDoorError';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('store3c.bids.title'), robots: { index: false, follow: false } };
}

export default async function PlatformMyBidsDoor({ searchParams }: { searchParams: SP }) {
  await requireSession(`/auctions/bids${carryQuery(searchParams, ['cursor'])}`);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}/auctions/bids${carryQuery(searchParams, ['cursor'])}`);
  return <StoreDoorError titleKey="store3c.bids.title" path="/auctions/bids" searchParams={searchParams} />;
}
