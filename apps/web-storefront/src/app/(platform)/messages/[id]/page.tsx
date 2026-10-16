// apps/web-storefront/src/app/(platform)/messages/[id]/page.tsx · PC-56 STORE-4b · C2 (founder Q13) — THE PLATFORM'S THREAD IS A DOOR carrying
// the id: a signed-in buyer is sent to /<slug>/messages/<id> under the organisation's chrome (canon W298) for the store their session was
// minted for; the thread there 404s if it is not theirs. If the session's store cannot be read: said, with a Retry — never a guessed store.
// (Its actions.ts is deleted: the composer, the report and every act live under the slug.)
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { sessionStoreSlug, carryQuery } from '../../../../lib/store-door';
import { StoreDoorError } from '../../../../components/StoreDoorError';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const KEEP = ['status'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('messages.threadTitle'), robots: { index: false, follow: false } };
}

export default async function PlatformThreadDoor({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  const id = UUID.test(params.id) ? params.id : null;
  const here = id ? `/messages/${encodeURIComponent(id)}` : '/messages';
  await requireSession(`${here}${carryQuery(searchParams, KEEP)}`);
  const slug = await sessionStoreSlug();
  if (slug) redirect(`/${encodeURIComponent(slug)}${here}${carryQuery(searchParams, KEEP)}`);
  return <StoreDoorError titleKey="messages.threadTitle" path={here} searchParams={searchParams} />;
}
