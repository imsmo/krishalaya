// apps/web-storefront/src/app/(platform)/auctions/page.tsx · PC-56 STORE-3c · C1 (founder D4; the 2c /auctions/[id] door pattern) — THE PLATFORM'S
// /auctions IS A DOOR to the auction list under its organisation's chrome (`/<slug>/auctions`, canon W295).
//
// What was true (survey C-5): this page read the AuthGuard `GET /v1/auctions` ANONYMOUSLY — it always failed, and the page said "no auctions are
// running" whatever existed; it was shown or hidden by a BUILD-TIME switch (`env.featureAuctions`, now DELETED) over a DB flag seeded OFF; it
// printed the start price as rupees (`'INR'` — the last storefront literal of it). Now: a signed-in buyer goes to the auctions of the store
// their session was minted for (one store per session), carrying the tab and the cursor; with no session the door cannot know the store and
// says so — it never guesses a store. The store's own page reads the store's `auctions` flag (the DB decides, through the allow-list).
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveSessionToken } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { sessionStoreSlug, carryQuery } from '../../../lib/store-door';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('auctions.title'), robots: { index: false, follow: true } };
}

export default async function PlatformAuctionsDoor({ searchParams }: { searchParams: SP }) {
  const t = getTranslator();
  if (await resolveSessionToken()) {
    const slug = await sessionStoreSlug();
    if (slug) redirect(`/${encodeURIComponent(slug)}/auctions${carryQuery(searchParams, ['tab', 'cursor'])}`);
  }
  return (
    <section className="kv-auction">
      <h1>{t.t('auctions.title')}</h1>
      <div className="kv-state" role="status" data-kv-state="which-store">
        <p>{t.t('store3c.door.whichStore')}</p>
        <Link href="/discover" className="kv-btn">{t.t('store2c.auction.findStore')}</Link>
      </div>
    </section>
  );
}
