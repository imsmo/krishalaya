// apps/web-ops/src/app/aeps/home/page.tsx · PC-56 OPS-1b · W390 (canon `aeps/home`) — AePS HOME, AN HONEST PAGE THAT READS NOTHING (founder Q1-A).
// No API call at all (the optional `/me` "your profile can record AePS events" line was NOT added — the page stays readless; whether a
// person may record is answered by the record act itself: 403 → "not enabled"). Every visit prints the same page.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { AepsHomeView } from '../../../components/ops1/AepsViews';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops1.aeps.home.title'), robots: { index: false, follow: false } };
}
export default async function AepsHomePage() {
  await requireSession('/aeps/home');
  return <AepsHomeView t={getTranslator()} />;
}
