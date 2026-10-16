// apps/web-storefront/src/app/(platform)/messages/page.tsx · PC-56 STORE-4b · C1 (founder Q13, the 2c/3a/4c door pattern) — THE PLATFORM'S
// /messages IS A DOOR. A buyer's threads are WITH THE ORGANISATION (founder D1), so the list lives under the organisation's chrome at
// /<slug>/messages (canon W297); a signed-in buyer is sent to the list of the store their session was minted for (one store per session),
// carrying the cursor; an anonymous visitor signs in first (requireSession). If the session's store cannot be read: said, with a Retry — never a
// guessed store. (The pre-4b page read every thread, platform support included, under the platform's own header.)
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { sessionStoreSlug, carryQuery } from '../../../lib/store-door';
import { StoreDoorError } from '../../../components/StoreDoorError';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const KEEP = ['cursor'] as const;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('messages.title'), robots: { index: false, follow: false } };
}

export default async function PlatformMessagesDoor({ searchParams }: { searchParams: SP }) {
  await requireSession(`/messages${carryQuery(searchParams, KEEP)}`);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}/messages${carryQuery(searchParams, KEEP)}`);
  return <StoreDoorError titleKey="messages.title" path="/messages" searchParams={searchParams} />;
}
