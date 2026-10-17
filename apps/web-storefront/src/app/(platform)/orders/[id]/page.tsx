// apps/web-storefront/src/app/(platform)/orders/[id]/page.tsx · PC-56 STORE-3a · C2 (founder D3) — THE PLATFORM'S /orders/[id] IS A DOOR to
// /<slug>/orders/[id] (canon W289 under the organisation's chrome — the logic lives there, no second copy), carrying `ok` / `error` / `status`
// (the review page's "reviewed" notice). Offer and auction links that still point here arrive at the right store. The session's store
// unreadable → said, with a Retry. (`/orders/[id]/review` — W290 — is its own door since STORE-5a: the page lives at /<slug>/orders/[id]/review.)
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
  return { title: t.t('order.detailTitle'), robots: { index: false, follow: false } };
}

export default async function PlatformOrderDoor({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  const path = `/orders/${encodeURIComponent(params.id)}`;
  await requireSession(path);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}${path}${carryQuery(searchParams, ['ok', 'error', 'status'])}`);
  return <StoreDoorError titleKey="order.detailTitle" path={path} searchParams={searchParams} />;
}
