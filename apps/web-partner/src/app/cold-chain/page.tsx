// apps/web-partner/src/app/cold-chain/page.tsx · PC-56 PARTNER-0 · founder D8 — NOT YET AVAILABLE IN THE PARTNER CONSOLE.
// This page read an organisation's (FPO's) records through a TENANT route, which a partner session cannot use (the API refuses a partner
// token there). Until its own wave gives it a partner read, it prints ONE honest state and calls nothing (features/partner/not-yet.ts).
import type { Metadata } from 'next';
import { requirePartner } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { NotYet, notYetTitle } from '../../components/NotYet';

export const dynamic = 'force-dynamic';
const ROUTE = '/cold-chain';

export function generateMetadata(): Metadata {
  return { title: notYetTitle(getTranslator(), ROUTE), robots: { index: false, follow: false } };
}

export default async function NotYetPage() {
  await requirePartner();
  return <NotYet t={getTranslator()} route={ROUTE} />;
}
