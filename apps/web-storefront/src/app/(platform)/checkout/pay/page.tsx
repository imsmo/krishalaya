// apps/web-storefront/src/app/(platform)/checkout/pay/page.tsx · PC-56 STORE-2c · C1 — THE PLATFORM'S /checkout/pay IS A DOOR to /<slug>/checkout/pay
// (canon W286 under the organisation's chrome; the HOTFIX-4 page's logic moved there — no second copy). Older links (an order page's "Pay",
// a HOTFIX-4 confirmation) keep working: the order and its group ride along.
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
  return { title: t.t('checkout.payTitle'), robots: { index: false, follow: false } };
}

export default async function PlatformPayDoor({ searchParams }: { searchParams: SP }) {
  await requireSession(`/checkout/pay${carryQuery(searchParams, ['o', 'g'])}`);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}/checkout/pay${carryQuery(searchParams, ['o', 'g', 'cn', 'via'])}`);
  return <StoreDoorError titleKey="checkout.payTitle" path="/checkout/pay" searchParams={searchParams} />;
}
