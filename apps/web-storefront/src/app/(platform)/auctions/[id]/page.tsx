// apps/web-storefront/src/app/(platform)/auctions/[id]/page.tsx · PC-56 STORE-2c · C6 — THE PLATFORM'S /auctions/[id] IS A DOOR to the auction under
// its organisation's chrome (`/<slug>/auctions/[id]`, canon W278). An auction is one organisation's: a signed-in buyer goes to the store their
// session belongs to; with no session the door cannot know the store and says so (an auction is opened from its organisation's store or the
// listing that carries it) — it never guesses a store, and never renders the old page that read an authed route anonymously (survey C-3).
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveSessionToken } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { sessionStoreSlug } from '../../../../lib/store-door';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('auctions.detailTitle'), robots: { index: false, follow: true } };
}

export default async function PlatformAuctionDoor({ params }: { params: { id: string } }) {
  const t = getTranslator();
  const id = /^[0-9a-fA-F-]{36}$/.test(params.id) ? params.id : null;
  if (id && await resolveSessionToken()) {
    const slug = await sessionStoreSlug();
    if (slug) redirect(`/${encodeURIComponent(slug)}/auctions/${encodeURIComponent(id)}`);
  }
  return (
    <section className="kv-auction">
      <h1>{t.t('auctions.detailTitle')}</h1>
      <div className="kv-state" role="status" data-kv-state="which-store">
        <p>{t.t('store2c.auction.whichStore')}</p>
        <Link href="/discover" className="kv-btn">{t.t('store2c.auction.findStore')}</Link>
      </div>
    </section>
  );
}
