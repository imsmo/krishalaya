// apps/web-storefront/src/app/(platform)/offers/page.tsx · PC-56 STORE-3b · C1 (the 3a C1 pattern) — THE PLATFORM'S /offers IS A DOOR.
// A buyer's offers live under the organisation's chrome at /<slug>/offers (canon W293 — status chips with bounded counts, flag-aware); a signed-in
// buyer is sent to the offers of the store their session was minted for (one store per session, 2b D3), carrying the status chip and the cursor;
// an anonymous visitor signs in first (requireSession). If the session's store cannot be read: said, with a Retry — never a guessed store.
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
  return { title: t.t('offers.title'), robots: { index: false, follow: false } };
}

export default async function PlatformOffersDoor({ searchParams }: { searchParams: SP }) {
  await requireSession(`/offers${carryQuery(searchParams, ['status', 'cursor'])}`);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}/offers${carryQuery(searchParams, ['status', 'cursor'])}`);
  return <StoreDoorError titleKey="offers.title" path="/offers" searchParams={searchParams} />;
}
