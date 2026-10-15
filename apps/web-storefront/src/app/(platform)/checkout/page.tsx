// apps/web-storefront/src/app/(platform)/checkout/page.tsx · PC-56 STORE-2c · C1 (founder 2b D3 carried) — THE PLATFORM'S /checkout IS A DOOR.
// Checkout lives under the organisation's chrome at /<slug>/checkout (three steps, server-held choices — canon W283 / W284 / W285). A signed-in
// buyer is sent to the checkout of the store their session was minted for, carrying the refusal status a cart / 2b link may have set; an
// anonymous visitor goes to sign in first (requireSession). If the session's store cannot be read: said, with a Retry.
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
  return { title: t.t('checkout.title'), robots: { index: false, follow: false } };
}

export default async function PlatformCheckoutDoor({ searchParams }: { searchParams: SP }) {
  await requireSession('/checkout');
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}/checkout${carryQuery(searchParams, ['step', 'status', 'region'])}`);
  return <StoreDoorError titleKey="checkout.title" path="/checkout" searchParams={searchParams} />;
}
