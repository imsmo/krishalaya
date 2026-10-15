// apps/web-storefront/src/app/(platform)/checkout/confirm/page.tsx · PC-56 STORE-2c · C1 — THE PLATFORM'S /checkout/confirm IS A DOOR to
// /<slug>/checkout/confirm (the HOTFIX-4 confirmation under the organisation's chrome — its logic moved there, no second copy).
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
  return { title: t.t('checkout.confirmTitle'), robots: { index: false, follow: false } };
}

export default async function PlatformConfirmDoor({ searchParams }: { searchParams: SP }) {
  await requireSession(`/checkout/confirm${carryQuery(searchParams, ['o', 'g'])}`);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}/checkout/confirm${carryQuery(searchParams, ['o', 'g', 'cn'])}`);
  return <StoreDoorError titleKey="checkout.confirmTitle" path="/checkout/confirm" searchParams={searchParams} />;
}
