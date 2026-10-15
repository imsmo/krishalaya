// apps/web-storefront/src/app/(platform)/orders/page.tsx · PC-56 STORE-3a · C1 (founder D3, the 2c C1 pattern) — THE PLATFORM'S /orders IS A DOOR.
// A buyer's orders live under the organisation's chrome at /<slug>/orders (canon W288 — five tabs, bounded counts); a signed-in buyer is sent to
// the orders of the store their session was minted for (one store per session, 2b D3), carrying the tab and the cursor; an anonymous visitor
// signs in first (requireSession). If the session's store cannot be read: said, with a Retry — never a guessed store. The canon's "Flagged off —
// My Orders disabled" is refused by name: a buyer's own order history has no kill-switch.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { sessionStoreSlug, carryQuery } from '../../../lib/store-door';
import { StoreDoorError } from '../../../components/StoreDoorError';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('order.listTitle'), robots: { index: false, follow: false } };
}

export default async function PlatformOrdersDoor({ searchParams }: { searchParams: SP }) {
  await requireSession(`/orders${carryQuery(searchParams, ['group', 'cursor'])}`);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}/orders${carryQuery(searchParams, ['group', 'cursor'])}`);
  return <StoreDoorError titleKey="order.listTitle" path="/orders" searchParams={searchParams} />;
}
