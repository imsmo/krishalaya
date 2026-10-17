// apps/web-storefront/src/app/(platform)/orders/[id]/review/page.tsx · PC-56 STORE-5a · C1 (founder Q13, survey C-13 / F-16) — THE PLATFORM'S
// /orders/[id]/review IS A DOOR to /<slug>/orders/[id]/review (canon W290 under the ORGANISATION's chrome — the page and its chains live there,
// no second copy; the old platform form and its action module are deleted). Carries `status` / `ok`. The session's store unreadable → said,
// with a Retry (lib/store-door.ts — never a guessed store).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSession } from '../../../../../lib/session';
import { getTranslator } from '../../../../../lib/i18n';
import { sessionStoreSlug, carryQuery } from '../../../../../lib/store-door';
import { StoreDoorError } from '../../../../../components/StoreDoorError';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('review.title'), robots: { index: false, follow: false } };
}

export default async function PlatformReviewDoor({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  const path = `/orders/${encodeURIComponent(params.id)}/review`;
  await requireSession(path);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}${path}${carryQuery(searchParams, ['status', 'ok'])}`);
  return <StoreDoorError titleKey="review.title" path={path} searchParams={searchParams} />;
}
