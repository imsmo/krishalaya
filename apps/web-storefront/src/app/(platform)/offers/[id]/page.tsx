// apps/web-storefront/src/app/(platform)/offers/[id]/page.tsx · PC-56 STORE-3b · C1 (the 3a C2 pattern) — THE PLATFORM'S /offers/[id] IS A DOOR
// to /<slug>/offers/[id] (canon W294 under the organisation's chrome — the logic lives there, no second copy), carrying the chain's query (`act`,
// `ok`, `error`). The old page's "Message seller" act is GONE (founder D6 — `messageSellerAction` deleted with this route's actions.ts; STORE-4
// builds organisation messaging). The session's store unreadable → said, with a Retry.
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
  return { title: t.t('offers.detailTitle'), robots: { index: false, follow: false } };
}

export default async function PlatformOfferDoor({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  const path = `/offers/${encodeURIComponent(params.id)}`;
  await requireSession(path);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}${path}${carryQuery(searchParams, ['act', 'ok', 'error'])}`);
  return <StoreDoorError titleKey="offers.detailTitle" path={path} searchParams={searchParams} />;
}
