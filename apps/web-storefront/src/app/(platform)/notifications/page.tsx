// apps/web-storefront/src/app/(platform)/notifications/page.tsx · PC-56 STORE-4c · C1 (founder Q13, the 2c/3a door pattern) — THE PLATFORM'S
// /notifications IS A DOOR. Notices carry the organisation that sent them, so the inbox lives under the organisation's chrome at
// /<slug>/notifications (canon W299); a signed-in buyer is sent to the inbox of the store their session was minted for (one store per session),
// carrying the tab, the cursor and an outcome; an anonymous visitor signs in first (requireSession). If the session's store cannot be read: said,
// with a Retry — never a guessed store. A person's notices have no kill-switch (founder Q12): no "Flagged off" here either.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { sessionStoreSlug, carryQuery } from '../../../lib/store-door';
import { StoreDoorError } from '../../../components/StoreDoorError';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const KEEP = ['unread', 'cursor', 'ok'] as const;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.title'), robots: { index: false, follow: false } };
}

export default async function PlatformNotificationsDoor({ searchParams }: { searchParams: SP }) {
  await requireSession(`/notifications${carryQuery(searchParams, KEEP)}`);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}/notifications${carryQuery(searchParams, KEEP)}`);
  return <StoreDoorError titleKey="notif.title" path="/notifications" searchParams={searchParams} />;
}
