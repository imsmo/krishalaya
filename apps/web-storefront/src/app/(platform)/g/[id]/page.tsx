// apps/web-storefront/src/app/(platform)/g/[id]/page.tsx · PC-56 STORE-3c · C1 — THE PLATFORM'S /g/[id] IS A DOOR to the group lot under its
// organisation's chrome (`/<slug>/g/[id]`, canon W279). A lot is one organisation's: a signed-in buyer goes to the store their session belongs to;
// with no session the door cannot know the store and says so (a lot is opened from its organisation's store) — it never guesses a store.
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveSessionToken } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { sessionStoreSlug } from '../../../../lib/store-door';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('store3c.gl.badge'), robots: { index: false, follow: true } };
}

export default async function PlatformGroupLotDoor({ params }: { params: { id: string } }) {
  const t = getTranslator();
  const id = /^[0-9a-fA-F-]{36}$/.test(params.id) ? params.id : null;
  if (id && await resolveSessionToken()) {
    const slug = await sessionStoreSlug();
    if (slug) redirect(`/${encodeURIComponent(slug)}/g/${encodeURIComponent(id)}`);
  }
  return (
    <section className="kv-group-lot">
      <h1>{t.t('store3c.gl.badge')}</h1>
      <div className="kv-state" role="status" data-kv-state="which-store">
        <p>{t.t('store3c.door.whichStoreLot')}</p>
        <Link href="/discover" className="kv-btn">{t.t('store2c.auction.findStore')}</Link>
      </div>
    </section>
  );
}
